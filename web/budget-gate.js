/*
 * budget-gate.js - 브라우저에서 실행하는 구매력 계산과 예산 게이트
 *
 * 원칙
 *  - 소득·자산 입력값은 이 모듈 안에서만 쓰고 서버로 보내거나 저장하지 않는다.
 *  - 규칙(LTV, 한도, DSR, 세율)은 rules.json에서 받는다. 값이 비었거나 verified가 아니면 예외를 던진다(실패는 닫는 쪽).
 *  - 예산을 넘는 지역은 affordable에 절대 넣지 않고 overBudget에 부족 금액과 함께 분리한다.
 *  - 종합점수를 만들지 않는다. 우선순위 기준의 파레토 후보만 고른다.
 * 금액 단위는 원(KRW)이다.
 */
(function (root) {
  'use strict';

  function ruleValue(rules, id) {
    var list = Array.isArray(rules) ? rules : (rules && rules.rules) || [];
    var r = list.find(function (x) { return x.id === id; });
    if (!r || r.value === null || r.value === undefined || r.status !== 'verified') {
      throw new Error('rule unverified: ' + id);
    }
    return r.value;
  }

  function sortedTiers(tiers) {
    return tiers.slice().sort(function (a, b) {
      var x = a.up_to === null ? Infinity : a.up_to;
      var y = b.up_to === null ? Infinity : b.up_to;
      return x - y;
    });
  }

  function tierValue(tiers, price, key) {
    var list = sortedTiers(tiers);
    for (var i = 0; i < list.length; i++) {
      if (list[i].up_to === null || price <= list[i].up_to) return list[i][key];
    }
    throw new Error('tier not found for price ' + price);
  }

  function validateProfile(p) {
    ['equity', 'annualIncome', 'existingAnnualRepayment', 'interestRate', 'loanYears'].forEach(function (k) {
      var v = p[k] === undefined && k === 'existingAnnualRepayment' ? 0 : p[k];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error('invalid profile: ' + k);
    });
    if (!(p.loanYears > 0)) throw new Error('invalid profile: loanYears');
    if (typeof p.regulated !== 'boolean') throw new Error('invalid profile: regulated');
  }

  function dsrPrincipal(profile, rules) {
    var limit = ruleValue(rules, 'dsr_limit');
    var stress = ruleValue(rules, 'stress_rate_addon')[profile.regulated ? 'regulated' : 'non_regulated'];
    var maxAnnual = profile.annualIncome * limit - (profile.existingAnnualRepayment || 0);
    if (maxAnnual <= 0) return 0;
    var r = (profile.interestRate + stress) / 12;
    var n = profile.loanYears * 12;
    var monthly = maxAnnual / 12;
    if (r <= 0) return monthly * n;
    return monthly * (1 - Math.pow(1 + r, -n)) / r;
  }

  function loanLimit(price, profile, rules) {
    var ltv = ruleValue(rules, 'ltv')[profile.regulated ? 'regulated' : 'non_regulated'];
    var byLtv = price * ltv;
    var byTier = tierValue(ruleValue(rules, 'loan_cap_tiers'), price, 'cap');
    var byDsr = dsrPrincipal(profile, rules);
    var loan = Math.max(0, Math.min(byLtv, byTier, byDsr));
    var binding = loan === byLtv ? 'ltv' : (loan === byTier ? 'tier' : 'dsr');
    return { loan: loan, binding: binding, byLtv: byLtv, byTier: byTier, byDsr: byDsr };
  }

  function costs(price, rules) {
    var tax = tierValue(ruleValue(rules, 'acquisition_tax'), price, 'rate');
    return price * (tax + ruleValue(rules, 'other_costs_rate'));
  }

  // 구매가능가격 = 자기자금 + 대출가능액 - 부대비용. 가격 구간별 한도가 계단식이라 이진 탐색 대신 순차 탐색한다.
  function maxAffordablePrice(profile, rules, step) {
    validateProfile(profile);
    step = step || 1000000;
    var upper = profile.equity + dsrPrincipal(profile, rules);
    var best = { maxPrice: 0, loan: 0, costs: 0, binding: null };
    for (var price = step; price <= upper + step; price += step) {
      var l = loanLimit(price, profile, rules);
      var c = costs(price, rules);
      if (profile.equity + l.loan - c >= price) {
        best = { maxPrice: price, loan: l.loan, costs: c, binding: l.binding };
      }
    }
    return best;
  }

  function splitByBudget(regions, budgetFor) {
    var affordable = [];
    var overBudget = [];
    regions.forEach(function (r) {
      var max = budgetFor(r);
      if (r.representativePrice <= max) {
        affordable.push(r);
      } else {
        overBudget.push(Object.assign({}, r, { shortfall: r.representativePrice - max }));
      }
    });
    return { affordable: affordable, overBudget: overBudget };
  }

  // metrics는 높을수록 좋은 값으로 정규화되어 있다고 가정한다.
  function paretoFront(cands, keys) {
    return cands.filter(function (a) {
      return !cands.some(function (b) {
        return b !== a &&
          keys.every(function (k) { return b.metrics[k] >= a.metrics[k]; }) &&
          keys.some(function (k) { return b.metrics[k] > a.metrics[k]; });
      });
    });
  }

  function orderByPriority(cands, priorities) {
    return cands.slice().sort(function (a, b) {
      for (var i = 0; i < priorities.length; i++) {
        var d = b.metrics[priorities[i]] - a.metrics[priorities[i]];
        if (d !== 0) return d;
      }
      return 0;
    });
  }

  function recommend(regions, profile, rules, priorities, topN) {
    validateProfile(profile);
    var cache = {};
    function budgetFor(region) {
      var flag = !!region.regulated;
      if (!(flag in cache)) {
        cache[flag] = maxAffordablePrice(Object.assign({}, profile, { regulated: flag }), rules).maxPrice;
      }
      return cache[flag];
    }
    var split = splitByBudget(regions, budgetFor);
    var front = paretoFront(split.affordable, priorities);
    return {
      candidates: orderByPriority(front, priorities).slice(0, topN || 3),
      overBudget: split.overBudget,
      maxPriceByRegulation: { regulated: cache[true], non_regulated: cache[false] }
    };
  }

  var api = {
    maxAffordablePrice: maxAffordablePrice,
    loanLimit: loanLimit,
    splitByBudget: splitByBudget,
    paretoFront: paretoFront,
    recommend: recommend
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BoardBudget = api;
})(typeof window !== 'undefined' ? window : globalThis);
