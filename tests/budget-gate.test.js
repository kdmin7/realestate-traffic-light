// 실행: node tests/budget-gate.test.js
// 아래 규칙 값은 테스트 전용 가상 값이다(TEST_ONLY). 실제 규칙이 아니며 rules/rules.json에 복사하면 안 된다.
import assert from 'assert';
import '../web/budget-gate.js';
const B = globalThis.BoardBudget;

const rule = (id, value) => ({ id, value, status: 'verified' });
const TEST_ONLY_RULES = { rules: [
  rule('ltv', { regulated: 0.4, non_regulated: 0.7 }),
  rule('loan_cap_tiers', [{ up_to: 1.5e9, cap: 6e8 }, { up_to: 2.5e9, cap: 4e8 }, { up_to: null, cap: 2e8 }]),
  rule('dsr_limit', 0.4),
  rule('stress_rate_addon', { regulated: 0.03, non_regulated: 0.015 }),
  rule('acquisition_tax', [{ up_to: 6e8, rate: 0.01 }, { up_to: null, rate: 0.03 }]),
  rule('other_costs_rate', 0.004)
] };
const profile = { equity: 5e8, annualIncome: 1e8, existingAnnualRepayment: 0, interestRate: 0.04, loanYears: 30, regulated: false };

// 1) 규칙이 비었거나 verified가 아니면 실패는 닫는다
const unverified = { rules: TEST_ONLY_RULES.rules.map((r) => Object.assign({}, r, { status: 'unverified' })) };
assert.throws(() => B.maxAffordablePrice(profile, unverified), /rule unverified/);
const nullRules = { rules: TEST_ONLY_RULES.rules.map((r) => Object.assign({}, r, { value: null })) };
assert.throws(() => B.maxAffordablePrice(profile, nullRules), /rule unverified/);

// 2) 입력 검증
assert.throws(() => B.maxAffordablePrice(Object.assign({}, profile, { equity: -1 }), TEST_ONLY_RULES), /invalid profile/);
assert.throws(() => B.maxAffordablePrice(Object.assign({}, profile, { regulated: 'yes' }), TEST_ONLY_RULES), /invalid profile/);

// 3) 구매가능가격은 자기자금 + 대출 - 부대비용 이하로 자금이 충당되는 최대 가격이다
const r1 = B.maxAffordablePrice(profile, TEST_ONLY_RULES);
assert.ok(r1.maxPrice > profile.equity);
assert.ok(profile.equity + r1.loan - r1.costs >= r1.maxPrice);

// 4) 규제지역(LTV가 낮음)은 같은 조건에서 구매가능가격이 더 작거나 같다
const r2 = B.maxAffordablePrice(Object.assign({}, profile, { regulated: true }), TEST_ONLY_RULES);
assert.ok(r2.maxPrice <= r1.maxPrice);

// 5) 가격 구간 한도는 계단식이라 구간 경계를 넘으면 대출 한도가 줄어든다
const below = B.loanLimit(1.5e9, Object.assign({}, profile, { annualIncome: 1e10 }), TEST_ONLY_RULES);
const above = B.loanLimit(1.5e9 + 1e6, Object.assign({}, profile, { annualIncome: 1e10 }), TEST_ONLY_RULES);
assert.ok(above.loan < below.loan);

// 6) 예산 초과 지역은 후보에 들어가지 않고 부족 금액과 함께 분리된다
const regions = [
  { name: 'A', representativePrice: 4e8, regulated: false, metrics: { school: 3, commerce: 1, station: 1 } },
  { name: 'B', representativePrice: 6e8, regulated: false, metrics: { school: 1, commerce: 3, station: 1 } },
  { name: 'C', representativePrice: 6e8, regulated: false, metrics: { school: 1, commerce: 1, station: 3 } },
  { name: 'D', representativePrice: 6e8, regulated: false, metrics: { school: 1, commerce: 1, station: 1 } },
  { name: 'E', representativePrice: 9e10, regulated: false, metrics: { school: 9, commerce: 9, station: 9 } }
];
const rec = B.recommend(regions, profile, TEST_ONLY_RULES, ['school', 'commerce', 'station'], 3);
assert.ok(rec.candidates.every((c) => c.representativePrice <= rec.maxPriceByRegulation.non_regulated));
assert.ok(!rec.candidates.some((c) => c.name === 'E'));
const over = rec.overBudget.find((c) => c.name === 'E');
assert.ok(over && over.shortfall > 0);
assert.ok(!rec.candidates.some((c) => c.name === 'D'), '다른 후보에게 모든 기준에서 밀리는 D는 제외되어야 한다');
assert.ok(rec.candidates.length <= 3);
assert.strictEqual(rec.candidates[0].name, 'A', '1순위 기준(school)이 가장 높은 후보가 먼저 와야 한다');

console.log('budget-gate: all tests passed');
