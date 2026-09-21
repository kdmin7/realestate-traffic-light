---
trigger: always_on
description: 근거 기반 부동산 게시판의 절대 규칙, 근거 등급, 파이프라인과 게이트, 파일 규약, 문체
---
# 근거 기반 부동산 정보·추천 게시판

서울·경기 지역의 부동산 정보를 근거 등급과 함께 보여주고, 사용자의 예산 안에서 후보와 트레이드오프를 제시하는 게시판을 만든다.
범위는 정보 제공, 조건별 추천, 커뮤니티다. **매물 등록과 거래 연결은 범위 밖이다.** 이 저장소의 어떤 산출물도 법률 자문이 아니다.

## 절대 규칙 (모든 에이전트가 따른다)

1. **등급이 없는 정보는 발행하지 않는다.** 모든 수치, 견해, 후기, 전망에 등급, 출처, 기준일이 붙는다.
2. **점수와 추천 계산은 A·B 등급만 읽는다.** C·D·E는 의견 패널에 표시만 하고 점수에 넣지 않는다.
3. **사용자의 구매력을 넘는 지역은 추천하지 않는다.** 예산 초과 지역은 참고 영역에 부족한 금액과 함께 분리한다.
4. **금지 문구를 쓰지 않는다.** 오를 지역, 저평가, 매수 타이밍 단정, 수익 보장, 확률 수치, 단일 순위 등. 목록은 `config/forbidden_phrases.json`.
5. **소득·자산 같은 개인 재정 입력은 저장하거나 서버·에이전트로 보내지 않는다.** 계산은 브라우저(`web/budget-gate.js`)에서만 한다.

## 근거 등급

| 등급 | 무엇 | 점수 반영 |
|---|---|---|
| A 공식 사실 | 실거래가, 학교 공시, 국가통계, 상권·철도 공식 데이터 | 사용 |
| B 규칙·계산 | 규칙 테이블을 적용한 계산 결과 | 사용 |
| C 전문가 견해 | 유튜버, 리포트 등의 해석 | 미사용 |
| D 개인 경험 | 회원 사례 | 미사용 |
| E 전망 | 앞으로의 시세·정책 예측 (시나리오 범위로만) | 미사용 |

## 파이프라인과 게이트

```
[사실 경로] re-market-data, re-safety-analyst -> A·B 저장소 -> re-trend-risk -> re-strategist
[규칙 경로] re-rules -> rules/rules.json (사람 승인 후 반영) -> re-strategist, 브라우저 예산 계산기
[의견 경로] fact-checker, community-moderator -> 의견 저장소 (표시 전용)
[출구]      re-reporter(초안) -> legal-reviewer -> 사람 승인 + validate_board(발행 시점 자동) -> publisher -> 게시판
```

- 오케스트레이터는 `board-orchestrator`다(`agy`에서 `/agents`로 선택). 작업자 에이전트는 `invoke_subagent` 도구가 없어 다른 에이전트를 호출하지 못한다.
- 게이트 중 하나라도 반려하면 `re-reporter`에게 사유와 함께 돌려보낸다. 두 번 반려되면 사람에게 넘긴다.
- **발행은 `publisher`만 한다.** 발행 도구(`board-write/publish_post`)는 `ask` 권한 규칙과 훅(`force_ask`)으로 권한 프리셋과 관계없이 매번 사람 승인을 받는다.
- 자세한 순서와 증적 체크리스트는 `.agents/skills/board-workflow/SKILL.md`.

## 파일 규약

- 기존 `data/re-*/` 경로를 유지한다. 근거 파일은 맨 위에 frontmatter를 둔다:
  `evidence_grade`(A 또는 B), `source_url`, `source_name`, `as_of`(YYYY-MM 또는 YYYY-MM-DD). 점수 파일은 `inputs_grades: [A, B]`도 둔다.
- 게시 초안은 `data/board/drafts/{slug}.md`. 형식은 `.agents/skills/region-card/SKILL.md`. slug는 영문 소문자·숫자·`-_`.
- 규칙 테이블은 `rules/rules.json`(Antigravity의 `.agents/rules/`와는 다른 것이다). **에이전트는 편집하지 못한다**(권한 deny 규칙). 갱신은 `rules/proposals/`에 제안을 쓰고 사람이 반영한다.
- 발행물(`data/board/published/`)과 게이트 기록(`data/board/gates/`)은 MCP 도구로만 바뀐다.

## 명령

- 검증: `python3 scripts/validate_board.py` (초안+규칙), `--draft SLUG`, `--only meta`, `--all`, `--strict`
- 테스트: `python3 -m unittest discover -s tests` 와 `node tests/budget-gate.test.js`

## 사용자에게 보이는 문체

- 존댓말. 단정하지 않고 조건과 기준일을 함께 쓴다("~로 나타납니다(기준일 2026-09)").
- 좋은 입지, 비싼 입지, 오를 입지를 구분한다. 얻는 것과 포기하는 것을 함께 쓴다.
- 감정을 부추기거나 조급함을 유발하는 표현을 쓰지 않는다. 특정 개인·중개사·단지를 비방하지 않는다.
- 견해는 자체 표현으로 짧게 요약하고 원본 링크를 단다. 영상 통째 요약, 자막, 썸네일, 유료 강의 내용을 옮기지 않는다.
