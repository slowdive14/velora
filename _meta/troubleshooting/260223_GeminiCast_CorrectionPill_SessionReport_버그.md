---
type: troubleshooting
status: done
description: "CorrectionPill 긴 문장 버벅임 + SessionReport 안 뜨는 버그 수정"
created: 2026-02-23
modified: 2026-02-23
phase: resolved
---

# 문제
> 1. 문법 교정 pill에 긴 문장이 뜨면 버벅임/레이아웃 폭발
> 2. 세션 종료 후 교정 리뷰 화면(SessionReport)이 안 뜸

---

# 시도
- CorrectionPill 컴포넌트 코드 및 onCorrection 핸들러 분석
- liveService.ts의 disconnect() → onclose → attemptReconnect() 흐름 추적
- 브라우저에서 pill/report DOM 시뮬레이션으로 UI 검증

---

# 원인

**Issue 1 - CorrectionPill 버벅임:**
- `App.tsx:756`에서 AI가 보낸 짧은 원문 구문(`"I goed to"`)을 사용자의 **전체 발화 턴 텍스트**(문단 전체)로 덮어씀
- pill에 문단이 통째로 표시 → 레이아웃 폭발, `backdrop-blur-md` + `shadow-2xl` GPU 부하
- 수평 flex에 긴 텍스트 두 개가 경쟁 → reflow 발생
- 입장/퇴장 애니메이션 없이 갑자기 나타남

**Issue 2 - SessionReport 안 뜸:**
- `liveService.ts`의 `disconnect()`에서 `session.close()` 호출 시 `onclose` 콜백 발동
- `onclose`에서 `reconnectAttempts(0) < maxReconnectAttempts(3)` 조건 충족 → **의도치 않은 재연결** 시도
- `setStatus('connecting')` 호출되면서 세션 종료 흐름이 꼬임
- 추가: Gemini 연결이 자체적으로 끊길 때 `stopRecording()`이 호출되지 않아 report가 절대 안 뜸

---

# 해결

**Issue 1:**
- `correction.original` 덮어쓰기 제거 → AI의 짧은 구문 유지
- 전체 턴 텍스트는 새 필드 `correction.turnText`에 별도 저장
- CorrectionPill: 수직 레이아웃 + `truncate` 말줄임 + `backdrop-blur-sm`/`shadow-lg`로 GPU 경량화
- 입장(`pill-slide-in`)/퇴장(`pill-fade-out`) CSS 애니메이션 추가
- SessionReport에서 `turnText`를 Context 영역에 `line-clamp-2`로 표시

**Issue 2:**
- `disconnect()`에 `this.reconnectAttempts = this.maxReconnectAttempts` 추가 → 재연결 방지
- `stopRecording()`에서 `isRecordingRef.current = false` 동기 업데이트 → race condition 방지
- `onClose` 콜백 확장: 녹음 중 연결 끊기면 자동으로 버퍼 flush + `setShowReport(true)`
- corrections `.slice(-10)` 제한 제거 → 모든 교정 내역 보존

---

# 관련 파일
- `C:\Users\user\Downloads\gemini-cast\types.ts` — `turnText` 필드 추가
- `C:\Users\user\Downloads\gemini-cast\index.css` — pill 애니메이션 키프레임
- `C:\Users\user\Downloads\gemini-cast\services\liveService.ts` — disconnect() 재연결 방지
- `C:\Users\user\Downloads\gemini-cast\components\CorrectionPill.tsx` — 레이아웃/애니메이션 리팩토링
- `C:\Users\user\Downloads\gemini-cast\components\SessionReport.tsx` — turnText Context 표시
- `C:\Users\user\Downloads\gemini-cast\App.tsx` — original 보존, slice 제거, ref 동기화, onClose 자동 리포트

---

# 재발 방지
- correction 데이터에서 "표시용 텍스트"와 "컨텍스트 텍스트"는 항상 분리 저장
- `disconnect()`처럼 연결 해제 메서드는 반드시 재연결 플래그를 차단한 뒤 `session.close()` 호출
- React state와 ref의 동기 타이밍이 중요한 곳은 ref를 먼저 동기 업데이트

---

# 쉬운 설명

### 문제
1. AI가 문법 교정 알림을 띄울 때 문장이 길면 화면이 버벅이고 알림이 너무 커졌다
2. 대화가 끝나면 교정 내역 리뷰 화면이 떠야 하는데 안 떴다

### 원인
1. 짧은 교정 문구 대신 사용자가 말한 전체 문단을 알림에 넣어버려서 알림이 폭발적으로 커졌다
2. 연결 끊기 함수에 버그가 있어서, "끊어!"라고 했는데 내부적으로 "다시 연결하자!"가 발동되면서 종료 흐름이 꼬였다

### 해결
1. 알림에는 짧은 교정 문구만 표시하고, 전체 문단은 리뷰 화면에서만 보여주도록 분리했다. 알림도 1줄로 자르고 애니메이션을 추가했다
2. 연결 끊기 시 재연결 시도를 완전히 차단하고, 연결이 갑자기 끊겨도 자동으로 리뷰 화면이 뜨도록 했다

### 관련 파일
- `C:\Users\user\Downloads\gemini-cast\types.ts`
- `C:\Users\user\Downloads\gemini-cast\index.css`
- `C:\Users\user\Downloads\gemini-cast\services\liveService.ts`
- `C:\Users\user\Downloads\gemini-cast\components\CorrectionPill.tsx`
- `C:\Users\user\Downloads\gemini-cast\components\SessionReport.tsx`
- `C:\Users\user\Downloads\gemini-cast\App.tsx`
