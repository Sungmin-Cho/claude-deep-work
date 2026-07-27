# Out-of-band edit recovery (approval hash mismatch)

> Reference for `skills/deep-work-orchestrator/SKILL.md`. The data-preservation + in-place-review procedure that runs when an approved research.md or plan.md was edited outside the workflow and its sha256 no longer matches the recorded approval hash.

---

   - 해시 불일치 → **out-of-band 편집 감지 → data preservation + in-place review** (fix + NP3 collision fix):
     1. 현재 `$WORK_DIR/research.md`를 `$WORK_DIR/research.v{iteration_count+1}-edit.md`로 복사 (편집 내용 백업). **`-edit` 접미사** 사용 — deep-research skill의 기존 `research.v{iteration_count}.md` backup과 파일명 충돌 방지.
     2. `iteration_count`을 1 증가.
     3. Approval state invalidate: `research_approved: false`, `research_approved_at: null`, `research_approved_hash: null`.
     4. 경고: "⚠️ research.md가 승인 이후 외부에서 수정되었습니다. 편집 내용은 research.v{N}-edit.md로 백업되었습니다. 편집된 현재 문서를 대상으로 Review+Approval을 재실행합니다."
     5. **Skill 재호출 없이** 아래 Review+Approval workflow (Step 1-6)로 직접 진입 — 현재 수정된 문서를 in-place review. template 기반 재생성 path는 스킵하여 사용자 편집 보존.
     6. 최종 승인 시 새 `research_approved_hash` 기록 (현재 편집된 파일의 sha256).
     7. 사용자가 거부 시 옵션 제공: 직접 수정 / `Skill("deep-research", args + " --force-rerun")`로 완전 재생성. `-edit` 접미사 덕분에 force-rerun 경로에서 skill의 자체 backup(`v{N}.md`)과 collision 없이 원본 편집 backup 보존됨.

---

   - 해시 불일치 → **out-of-band 편집 감지 → data preservation + in-place review** (fix + NP3 collision fix):
     1. 현재 `$WORK_DIR/plan.md`를 `$WORK_DIR/plan.v{iteration_count+1}-edit.md`로 복사. **`-edit` 접미사** 사용 — deep-plan skill의 기존 `plan.v{iteration_count}.md` backup(Pre-steps Backup 단계)과 파일명 충돌 방지.
     2. `iteration_count`을 1 증가.
     3. Approval state invalidate: `plan_approved: false`, `plan_approved_at: null`, `plan_approved_hash: null`.
     4. 경고: "⚠️ plan.md가 승인 이후 외부에서 수정되었습니다. 편집 내용은 plan.v{N}-edit.md로 백업되었습니다. 편집된 현재 문서를 대상으로 Review+Approval을 재실행합니다."
     5. **Skill 재호출 없이** 아래 Review+Approval workflow로 직접 진입 — 편집된 문서 in-place review.
     6. 최종 승인 시 새 `plan_approved_hash` + `plan_approved_at` 기록 (drift baseline 정정).
     7. 거부 시 사용자 선택: 직접 수정 / `Skill("deep-plan", args + " --force-rerun")`로 완전 재생성. `-edit` 접미사 덕분에 collision 없음.
