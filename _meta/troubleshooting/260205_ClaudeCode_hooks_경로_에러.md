---
type: troubleshooting
status: done
description: "Windows 네이티브 Claude Code에서 hooks 실행 시 경로 에러"
created: 2026-02-05
modified: 2026-02-05
phase: resolved
---

# 문제
> Windows 네이티브 버전 Claude Code에서 `PostToolUse hook error`, `UserPromptSubmit hook error` 발생

---

# 시도
- `~/.claude/...` 경로 사용 → 실패
- `/c/Users/user/.claude/...` (Git Bash 형식) → 실패
- `C:/Users/user/.claude/...` (Windows 형식) → 실패

---

# 원인
- Windows 네이티브 Claude Code는 WSL의 `/bin/bash`를 사용하여 hooks 실행
- WSL bash는 `~`, `/c/...`, `C:/...` 경로를 인식하지 못함
- npm 설치 버전은 Git Bash 사용, 네이티브 버전은 WSL bash 사용

---

# 해결
- WSL 경로 형식 `/mnt/c/Users/user/.claude/...` 사용

```json
// ~/.claude/settings.json
"command": "bash /mnt/c/Users/user/.claude/hooks/my-hook.sh"
```

---

# 관련 파일
- `C:\Users\user\.claude\settings.json`

---

# 재발 방지
- 글로벌 CLAUDE.md에 hooks 경로 규칙 기록 완료
- Windows 네이티브 버전 사용 시 항상 `/mnt/c/...` 형식 사용

---

# 📝 쉬운 설명

### 문제
Claude Code에서 자동으로 실행되는 스크립트(hooks)가 "파일을 찾을 수 없다"는 에러를 계속 냈음

### 원인
Windows용 Claude Code가 스크립트를 실행할 때 Linux 방식(WSL)을 사용하는데, 파일 경로를 Windows 방식으로 적어서 못 찾은 것

### 해결
경로를 Linux 방식으로 바꿈: `C:\Users\...` → `/mnt/c/Users/...`

### 관련 파일
- C:\Users\user\.claude\settings.json
- C:\Users\user\.claude\CLAUDE.md
