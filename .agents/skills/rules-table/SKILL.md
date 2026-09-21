---
name: rules-table
description: LTV·DSR·가격 구간별 한도·세율·부대비용 규칙 테이블을 공식 원문으로 확인하고 갱신 제안서를 만드는 절차. 규칙 갱신 점검이나 구매력 계산 전 규칙 상태 확인에 사용한다.
---
# 규칙 테이블 관리

규칙 값은 자주 바뀌고, 낡은 값으로 계산하면 잘못된 추천이 나간다. 그래서 값은 코드나 초안에 적지 않고 `rules/rules.json`에서만 조회한다.

## 절차
1. rules MCP의 `check_rules_freshness`로 어떤 규칙이 unverified이거나 오래됐는지 본다.
2. 공식 원문을 찾는다: 금융위원회 공고·보도자료, 국토교통부·정책브리핑, 국가법령정보센터(법령), 행정안전부·지자체(세율). 2차 자료는 어디를 볼지 알려주는 단서로만 쓴다.
3. `rules/proposals/{YYYY-MM-DD}_{rule_id}.md`에 제안서를 쓴다.
   - 규칙 id, 제안 값(`rules.json`의 `value_shape` 형식), 원문 URL, 시행일, 확인일
   - 기존 값과의 차이, 적용 대상(규제지역 여부 등), 확신 수준(원문 직접 확인 / 부분 확인)
4. **에이전트는 `rules.json`을 수정하지 못한다.** 사람이 제안서를 검토해 반영하고 `status: verified`, `checked_at`, `source_url`을 채운다.
5. 반영 후 `python3 scripts/validate_board.py --only rules`로 확인한다.

## 판단 기준
- 원문을 직접 확인하지 못했으면 verified가 아니다. 이전 값을 유지하고 "확인 필요"로 보고한다.
- 값이 null이거나 verified가 아니면 구매력 계산은 실패해야 한다(실패는 닫는다).
- 기본 확인 주기는 30일이며 `config/board_policy.json`에서 바꾼다.
