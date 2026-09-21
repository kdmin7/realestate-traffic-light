---
name: board-workflow
description: 게시판 제작·발행 파이프라인의 단계 순서, 게이트 증적 체크리스트, 반려 처리, 발행 절차. 오케스트레이션과 발행 전 확인에 사용한다.
---
# 게시판 워크플로

## 단계와 담당
| 단계 | 담당 | 산출물(증적) |
|---|---|---|
| 1 수집·정규화 | re-market-data, re-safety-analyst | `data/re-*/…` 파일 + frontmatter(등급·출처·기준일) |
| 2 점수 | re-trend-risk | `data/re-trend-risk/{slug}_scores.md` (`inputs_grades: [A, B]`) |
| 3 규칙 점검 | re-rules | `rules/proposals/…` (사람이 반영) |
| 4 견해·후기 | fact-checker, community-moderator | `data/board/claims/`, `data/board/experiences/` |
| 5 지표 팩·카드 | re-strategist | `data/board/pack/regions.json` |
| 6 초안 | re-reporter | `data/board/drafts/{slug}.md` |
| 7 법·표현 검토 | legal-reviewer | 게이트 기록 `legal.verdict = pass` |
| 8 결정적 검증 | 발행 시점에 훅(`validate_board.py --hook`)과 `publish_post`가 자동 수행. re-reporter는 작성 후 자체 점검 | 통과하지 못하면 발행이 거부됨 (`record_gate`(gate=validate)로 사전 기록도 가능) |
| 9 사람 승인 | 사람 | 발행 도구 호출의 승인 프롬프트(`ask` 규칙 + 훅 `force_ask`) |
| 10 발행 | publisher | `data/board/published/{slug}.md` |

3~5단계는 해당 주제가 있을 때만 수행한다. 6단계 초안은 사용한 근거 파일을 `sources`에 모두 적어야 한다.

## 발행 전 증적 체크리스트 (오케스트레이터가 확인)
- [ ] 초안의 `sources` 파일 모두에 `evidence_grade`(A/B), `source_url`, `as_of`가 있다
- [ ] 점수 파일의 `inputs_grades`가 A·B뿐이다
- [ ] 사실 패널의 모든 항목에 `[A|B | 출처 | 기준일]` 태그가 있다
- [ ] 의견 패널의 항목이 [C]/[D]/[E] 형식이고 필수 항목(이해관계·검증·시장 국면·인증·가정)이 있다
- [ ] 대출·구매력 내용이 있으면 `rules_as_of`가 있고 규칙이 verified다
- [ ] `legal.verdict`가 pass이며 초안 해시가 현재 초안과 같다 (결정적 검증은 발행 시점에 훅과 서버가 자동으로 다시 수행한다)
- [ ] 사람 승인을 받았다

## 반려 처리
게이트가 반려하면 사유를 그대로 re-reporter에게 전달해 고치게 하고 7~8단계를 다시 거친다. 같은 초안이 두 번 반려되면 멈추고 사람에게 남은 문제를 보고한다. 초안을 고치면 이전 게이트 기록은 해시가 달라져 자동으로 무효가 된다.

## 발행(publisher)
1. `view_file`로 `data/board/gates/{slug}.json`을 열어 `legal.verdict`가 pass인지 확인한다.
2. `publish_post` 호출 시 뜨는 승인 프롬프트로 사람 승인을 받는다. `ask` 규칙과 훅(`force_ask`)이 권한 프리셋과 관계없이 매번 승인을 요구한다.
3. `publish_post`를 호출한다. 훅과 서버가 결정적 검증을 다시 수행한다.
4. 실패 메시지는 그대로 보고하고, 우회하려 하지 않는다.
