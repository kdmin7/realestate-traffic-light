# 다른 PC로 옮기기 · 설치 가이드

이 번들에는 MCP 서버 소스와 **이 대화 기록**이 들어 있습니다.
`node_modules`(재설치 가능)와 `.cache`(재생성됨)는 용량을 줄이려 제외했습니다.

## 번들 구성

```
MCP-transfer.zip
├─ trade-server.js            반도체 수출입 MCP (관세청)
├─ realestate-server.js       서울 부동산 인사이트 MCP (8 tools)
├─ package.json / package-lock.json
├─ .gitignore
├─ README.md                  반도체 서버 문서
├─ README-seoul-realty.md     부동산 서버 문서
├─ dashboard.html             반도체 수출입 대시보드
├─ design.html                부동산 서버 설계도
├─ data/{crime,living_pop,income}/   (빈 폴더 — CSV는 새 PC에서 다시 내려받기)
└─ conversation.jsonl         이 대화 전체 기록
```

---

## 1) 새 PC에서 프로젝트 설치

```bash
# 1. 압축 해제 (예: 바탕화면\MCP)
# 2. 폴더로 이동 후 의존성 설치
cd <압축 푼 경로>
npm install
```
> Node.js 18 이상 필요.

## 2) API 키 설정 + MCP 등록

키는 **새 PC에서 다시 설정**합니다(키 자체는 계정 것이라 재사용 가능, 환경변수만 다시 지정).

> ⚠️ **경로 주의**: 새 PC의 사용자명이 다르면 경로가 바뀝니다.
> 예전에 `C:\Users\User\...` ↔ `C:\Users\LG\...` 문제가 있었죠. 아래 경로를 **새 PC 실제 경로**로 바꾸세요.

```bash
# 반도체 서버
claude mcp add semiconductor-trade \
  -e CUSTOMS_API_KEY=관세청_키 \
  -- node <새경로>\trade-server.js

# 부동산 서버
claude mcp add seoul-realty \
  -e MOLIT_API_KEY=국토부_키 \
  -e ECOS_API_KEY=한국은행_키 \
  -e NEIS_API_KEY=나이스_키 \
  -- node <새경로>\realestate-server.js
```

등록 확인: `claude mcp list`

## 3) 파일 데이터 다시 내려받기 (부동산 파일 도구용)

`get_crime_rate` · `get_living_population` · `get_region_income` 를 쓰려면 CSV가 필요합니다.
새 PC의 `data/` 폴더에 다시 넣으세요(자세한 링크는 `README-seoul-realty.md` 참고):
- `data/crime/` ← 경찰청 범죄 발생 지역별 통계
- `data/living_pop/` ← 자치구 단위 서울 생활인구
- `data/income/` ← KOSIS/국세청 시군구 소득

---

## 4) 대화 기록(conversation.jsonl) 복원

Claude Code는 대화 기록을 아래 위치에 저장합니다:
```
<사용자홈>\.claude\projects\<경로를_대시로_바꾼_폴더>\<세션ID>.jsonl
```

**새 PC에서 이 대화를 이어보려면:**
1. 새 PC에서 프로젝트를 둘 경로를 정합니다. 예: `C:\Users\LG\Desktop\MCP`
2. 그 경로를 인코딩한 폴더명을 만듭니다 — 슬래시·콜론을 `-` 로:
   `C:\Users\LG\Desktop\MCP` → `C--Users-LG-Desktop-MCP`
3. 다음 폴더에 `conversation.jsonl` 을 넣습니다(파일명은 원래 세션ID 유지 권장):
   ```
   C:\Users\LG\.claude\projects\C--Users-LG-Desktop-MCP\3b47aeaa-adef-4748-97f2-1f1694a3b8c0.jsonl
   ```
4. 해당 프로젝트 폴더에서 Claude Code 실행 후 `/resume` (또는 `claude --resume`)로 이 세션을 선택합니다.

> 폴더명이 **새 PC의 실제 프로젝트 경로와 정확히 일치**해야 목록에 나타납니다.
> 그냥 대화 내용만 읽고 싶으면 `conversation.jsonl` 을 텍스트 뷰어로 열어도 됩니다(JSON Lines 형식).

---

## 참고: Git으로 옮기는 방법(대안)

소스만 옮긴다면 GitHub 비공개 저장소가 더 깔끔합니다(`.gitignore`가 node_modules·CSV·캐시를 제외):
```bash
git init && git add . && git commit -m "init: korea public data MCP servers"
# GitHub에 비공개 repo 생성 후
git remote add origin <repo-url> && git push -u origin main
```
단, **API 키는 절대 커밋하지 마세요**(환경변수로만 전달). 대화 기록도 개인정보이니 공개 repo에 올리지 마세요.
