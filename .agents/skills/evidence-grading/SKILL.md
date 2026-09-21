---
name: evidence-grading
description: 지표·견해·후기·전망에 A~E 근거 등급을 부여하고 출처·기준일 누락을 점검한다. 데이터를 저장하거나 카드·초안을 만들기 전에 사용한다.
---
# 근거 등급 부여

## 절차
1. 항목마다 `evidence_grade`, `source_url`, `as_of`를 채운다. **하나라도 없으면 저장하지 않는다.**
2. 등급을 정한다.
   - A 공식 사실: 공식 통계·실거래·공시 그대로의 값
   - B 규칙·계산: 규칙 테이블이나 산식을 적용한 계산 결과
   - C 전문가 견해 / D 개인 경험 / E 전망
3. C·D·E는 점수 계산 입력 파일에 넣지 않는다. 의견 패널에만 쓴다.
4. 파일 맨 위에 frontmatter를 붙인다.

```yaml
---
evidence_grade: A            # 근거 파일은 A 또는 B만
source_url: https://...      # 원출처 URL
source_name: 국토교통부 실거래가 공개시스템
as_of: 2026-09               # YYYY-MM 또는 YYYY-MM-DD
inputs_grades: [A, B]        # 점수 파일에만: 사용한 입력의 등급
---
```

5. 초안의 사실 패널 항목은 줄 끝에 `[A | 출처 | 기준일]` 또는 `[B | 출처 | 기준일]` 태그를 단다.
6. 검증은 `python3 scripts/validate_board.py --only meta`(데이터 감사)와 `--draft SLUG`(초안)로 한다.

등급의 정의와 경계 사례는 `resources/grades.md`를 읽는다.
