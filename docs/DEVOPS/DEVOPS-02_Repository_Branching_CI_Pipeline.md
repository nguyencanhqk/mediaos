# DEVOPS-02: REPOSITORY, BRANCHING & CI PIPELINE
# REPOSITORY, BRANCHING & CI PIPELINE
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DEVOPS-02 |
| Tên tài liệu | Repository, Branching & CI Pipeline |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | DevOps, Deployment & Release Operations - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

DEVOPS-02 định nghĩa cách tổ chức repository, quy ước nhánh, commit, pull request và CI pipeline cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt mô hình repository cho frontend, backend, infrastructure và tài liệu.
2. Chốt quy tắc branch cho feature, bugfix, hotfix, release và main branch.
3. Chuẩn hóa commit message, pull request, code review và merge rule.
4. Xác định các bước CI bắt buộc trước khi merge.
5. Chuẩn hóa quality gate cho lint, typecheck, unit test, build, dependency scan và secret scan.
6. Làm nền cho DEVOPS-06 Backend Deployment Pipeline và DEVOPS-07 Frontend Deployment Pipeline.
7. Giúp QA, Backend, Frontend và DevOps có cùng tiêu chuẩn khi đưa code vào release candidate.

DEVOPS-02 không đi sâu vào deployment production; phần đó nằm ở DEVOPS-06, DEVOPS-07, DEVOPS-08 và DEVOPS-12.

## 3. Vị trí tài liệu trong chuỗi DevOps

Tài liệu **DEVOPS-02** nằm trong nhánh DevOps sau khi hệ thống đã có PRD, SPEC, Database Design, API Design, UI/UX, Frontend, Backend và QA readiness.

Chuỗi DevOps MVP được tổ chức như sau:

```text
DEVOPS-01: DevOps Architecture & Environment Strategy
  -> DEVOPS-02: Repository, Branching & CI Pipeline
  -> DEVOPS-03: Docker & Containerization
  -> DEVOPS-04: Environment Configuration & Secrets Management
  -> DEVOPS-05: Database Migration & Seed Deployment
  -> DEVOPS-06: Backend Deployment Pipeline
  -> DEVOPS-07: Frontend Deployment Pipeline
  -> DEVOPS-08: Staging, UAT & Production Environment
  -> DEVOPS-09: Monitoring, Logging & Alerting
  -> DEVOPS-10: Backup, Rollback & Disaster Recovery
  -> DEVOPS-11: Security Hardening & Runtime Protection
  -> DEVOPS-12: Release Management & Go-live Plan
```

Mục tiêu của chuỗi này là biến mã nguồn, database migration, cấu hình môi trường, test result và checklist QA thành hệ thống có thể triển khai, giám sát, backup, rollback và go-live an toàn.

## 4. Nguyên tắc DevOps áp dụng chung

1. **Production-like từ sớm**: staging/UAT phải gần giống production về runtime, biến môi trường, SSL, reverse proxy, migration, logging và monitoring.
2. **Backend là trust boundary**: frontend có thể ẩn/hiện UI nhưng backend/API luôn kiểm tra authentication, permission, data scope và business rule.
3. **Mỗi môi trường tách biệt**: local, development, staging/UAT và production có database, secret, domain và storage riêng.
4. **Không deploy bằng `latest` ở production**: image phải có tag rõ ràng theo version hoặc commit SHA để rollback và truy vết.
5. **Migration phải được kiểm soát**: mọi migration cần chạy qua staging trước production và production phải backup trước migration.
6. **Deploy an toàn hơn deploy nhanh**: production deploy cần approval, smoke test, monitoring window và rollback plan.
7. **Secret không nằm trong source code**: secret chỉ được lưu trong secret store của CI/CD, server hoặc secret manager.
8. **Quan sát được hệ thống**: log, metric, health check, alert và audit vận hành phải có từ MVP.
9. **Tự động hóa phần lặp lại**: build, test, scan, migration, deploy và smoke test nên chuẩn hóa bằng pipeline/script.
10. **Có checklist rõ ràng**: mỗi bước release phải có điều kiện pass/fail để tránh quyết định cảm tính.

## 5. Chiến lược repository

### 5.1 Mô hình repo khuyến nghị cho MVP

Khuyến nghị dùng **monorepo có phân vùng rõ** nếu team nhỏ hoặc vừa:

```text
ems/
  apps/
    backend-api/
    frontend-web/
  packages/
    shared-types/
    config/
  infra/
    docker/
    compose/
    scripts/
  docs/
    prd/
    spec/
    db/
    api/
    ui/
    frontend/
    backend/
    qa/
    devops/
  .github/
    workflows/
```

Lý do:

1. Dễ đồng bộ thay đổi API contract, shared types và release tag.
2. Dễ chạy CI tổng hợp cho frontend/backend/database migration.
3. Dễ quản lý tài liệu dự án trong cùng source of truth.
4. Dễ tạo release note dựa trên commit/PR.

Nếu team lớn hơn có thể tách repo:

| Repo | Nội dung | Ghi chú |
| --- | --- | --- |
| `ems-backend` | Backend API, worker, migration | Có pipeline riêng |
| `ems-frontend` | Web frontend | Có pipeline riêng |
| `ems-infra` | Docker, compose, deployment, script | Hạn chế quyền write |
| `ems-docs` | Tài liệu sản phẩm/kỹ thuật | Có thể nằm chung monorepo |

### 5.2 Quy tắc thư mục bắt buộc

| Nhóm | Quy tắc |
| --- | --- |
| Source code | Không để file secret, `.env.production`, private key |
| Migration | Mỗi migration có version, tên rõ, không sửa migration đã chạy production |
| Seed | Tách seed foundation, demo/test seed và production bootstrap seed |
| Script | Script deploy/backup/migrate phải idempotent hoặc có cảnh báo rõ |
| Docs | Tài liệu phải đặt theo mã tài liệu và version |
| CI | Workflow phải chạy được trên pull request và branch chính |

## 6. Branching strategy

### 6.1 Branch chính

| Branch | Vai trò | Ai được merge | Deploy target |
| --- | --- | --- | --- |
| `main` | Code ổn định cho production | Maintainer/Tech Lead | Production sau approval |
| `develop` | Tích hợp tính năng đã review | Dev Lead/Maintainer | Development shared |
| `release/*` | Release candidate | Tech Lead/Release Manager | Staging/UAT |
| `hotfix/*` | Sửa lỗi production khẩn cấp | Tech Lead | Staging -> Production |

### 6.2 Branch làm việc

| Loại branch | Format | Ví dụ |
| --- | --- | --- |
| Feature | `feature/<module>-<short-name>` | `feature/hr-employee-profile` |
| Bugfix | `bugfix/<module>-<issue>` | `bugfix/leave-balance-rounding` |
| Chore | `chore/<area>-<short-name>` | `chore/update-ci-cache` |
| Refactor | `refactor/<area>-<short-name>` | `refactor/api-error-handler` |
| Hotfix | `hotfix/<issue>-<short-name>` | `hotfix/login-500` |
| Release | `release/v<major>.<minor>.<patch>` | `release/v1.0.0` |

### 6.3 Luồng merge đề xuất

```text
feature/*
  -> Pull Request
  -> CI check
  -> code review
  -> merge vào develop
  -> deploy development
  -> gom release/*
  -> deploy staging/UAT
  -> QA regression + UAT sign-off
  -> merge release vào main
  -> tag release
  -> production deploy có approval
```

Hotfix:

```text
hotfix/* từ main
  -> CI check
  -> deploy staging/hotfix validation
  -> merge main
  -> tag patch
  -> production deploy
  -> back-merge vào develop
```

## 7. Commit convention

### 7.1 Format commit

```text
<type>(<scope>): <summary>
```

Ví dụ:

```text
feat(hr): add employee profile change request
fix(att): prevent check-in when approved leave exists
chore(devops): add backend ci workflow
```

### 7.2 Loại commit

| Type | Ý nghĩa |
| --- | --- |
| `feat` | Tính năng mới |
| `fix` | Sửa lỗi |
| `docs` | Tài liệu |
| `style` | Format code, không đổi logic |
| `refactor` | Refactor code |
| `test` | Test |
| `chore` | Build, CI, dependency, script |
| `perf` | Tối ưu hiệu năng |
| `security` | Sửa bảo mật |
| `revert` | Revert commit |

### 7.3 Scope khuyến nghị

```text
auth, hr, att, leave, task, dash, noti, foundation, api, db, frontend, backend, devops, qa
```

## 8. Pull request standard

### 8.1 Checklist PR bắt buộc

- [ ] PR có mô tả thay đổi rõ ràng.
- [ ] Gắn issue/task liên quan nếu có.
- [ ] Nêu ảnh hưởng tới DB/API/UI/permission nếu có.
- [ ] Có test hoặc lý do chưa thể test.
- [ ] Không chứa secret, token, password, private key.
- [ ] Không log dữ liệu nhạy cảm.
- [ ] Nếu có migration, mô tả rollback/forward-fix.
- [ ] Nếu có thay đổi API contract, cập nhật OpenAPI/docs/mock nếu cần.
- [ ] Nếu có thay đổi UI, có screenshot hoặc preview link nếu pipeline hỗ trợ.

### 8.2 Rule review

| Loại thay đổi | Reviewer tối thiểu |
| --- | --- |
| Frontend UI/logic | 1 FE reviewer |
| Backend API/business | 1 BE reviewer |
| Database migration | BE Lead hoặc DB owner |
| Permission/security | BE Lead + DevOps/Security owner |
| CI/CD/infra | DevOps owner |
| Production hotfix | Tech Lead hoặc Release Manager |

### 8.3 Merge rule

1. Không merge khi CI fail.
2. Không merge khi có unresolved comment quan trọng.
3. Không squash mất thông tin nếu release note cần trace nhiều commit.
4. Không merge trực tiếp vào `main` trừ hotfix đã được duyệt.
5. Không force push lên `main`, `develop`, `release/*`.

## 9. CI pipeline tổng quan

### 9.1 Trigger

| Trigger | Pipeline |
| --- | --- |
| Pull request vào `develop` | CI quality check |
| Push vào `develop` | CI + deploy development nếu bật |
| Tạo/ cập nhật `release/*` | CI + build image + deploy staging |
| Push vào `main` | CI + build image + production approval |
| Tag `v*` | Release artifact + production candidate |
| Manual dispatch | Rerun, smoke test, rollback helper |

### 9.2 Job bắt buộc

| Job | Backend | Frontend | Infra |
| --- | --- | --- | --- |
| Checkout | Có | Có | Có |
| Install dependency | Có | Có | Có nếu cần |
| Lint | Có | Có | Có với Docker/YAML |
| Typecheck | Có nếu TS | Có | Không bắt buộc |
| Unit test | Có | Có | Không bắt buộc |
| Build | Có | Có | Có với image |
| Secret scan | Có | Có | Có |
| Dependency scan | Có | Có | Có |
| Docker build | Có | Có | Có |
| Migration dry-run | Có | Không | Có nếu có DB test |

### 9.3 CI stages đề xuất

```text
validate
  -> install/cache
  -> lint
  -> typecheck
  -> unit test
  -> build
  -> dependency scan
  -> secret scan
  -> docker build smoke
  -> publish artifact/image nếu branch đủ điều kiện
```

## 10. Workflow mẫu ở mức định hướng

```yaml
name: ci

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main, 'release/**']

jobs:
  backend-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install backend dependencies
        run: npm ci
        working-directory: apps/backend-api
      - name: Lint backend
        run: npm run lint
        working-directory: apps/backend-api
      - name: Test backend
        run: npm test
        working-directory: apps/backend-api
      - name: Build backend
        run: npm run build
        working-directory: apps/backend-api

  frontend-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install frontend dependencies
        run: npm ci
        working-directory: apps/frontend-web
      - name: Lint frontend
        run: npm run lint
        working-directory: apps/frontend-web
      - name: Typecheck frontend
        run: npm run typecheck
        working-directory: apps/frontend-web
      - name: Build frontend
        run: npm run build
        working-directory: apps/frontend-web
```

Đây chỉ là skeleton. Workflow thực tế cần bổ sung cache, scan, artifact, Docker build, image push, environment approval và smoke test.

## 11. Quality gate trước merge

| Gate | Điều kiện pass |
| --- | --- |
| Lint | Không còn lỗi blocker |
| Typecheck | Pass toàn bộ package liên quan |
| Unit test | Pass; coverage không giảm quá ngưỡng cấu hình |
| Build | Build thành công |
| Secret scan | Không phát hiện secret thật |
| Dependency scan | Không có critical vulnerability chưa xử lý |
| Docker build | Image build được với production target |
| Migration check | Migration mới chạy được trên DB test |
| Review | Đủ reviewer bắt buộc approve |

## 12. CI artifact và traceability

Mỗi pipeline cần lưu hoặc gắn metadata:

| Metadata | Mục đích |
| --- | --- |
| Commit SHA | Trace code |
| Branch/tag | Trace release |
| Build number | Trace pipeline |
| Image tag | Deploy/rollback |
| Test report | QA evidence |
| Coverage report | Quality trend |
| SBOM nếu có | Security/compliance |
| Migration version | Database release evidence |

## 13. Quy tắc xử lý secret trong CI

1. Không in secret ra log.
2. Không đưa `.env` production vào artifact.
3. CI secret chia theo environment: development, staging, production.
4. Production secret chỉ workflow production được truy cập và cần approval.
5. Pull request từ fork không được truy cập secret nhạy cảm.
6. Secret scan phải chạy ở PR và branch chính.

## 14. Quy tắc version và tag

### 14.1 Semantic versioning cho release

```text
vMAJOR.MINOR.PATCH
```

Ví dụ:

```text
v1.0.0
v1.0.1
v1.1.0
```

### 14.2 Image tag

```text
<service>:<environment>-<git_short_sha>
<service>:v1.0.0
```

Ví dụ:

```text
ems-backend-api:staging-a1b2c3d
ems-frontend-web:v1.0.0
```

## 15. Permission và access repository

| Nhóm | Quyền repo |
| --- | --- |
| Developer | Push feature branch, tạo PR |
| Frontend Lead | Approve FE PR, merge develop nếu được giao |
| Backend Lead | Approve BE/DB PR, merge develop nếu được giao |
| QA | Read source, xem pipeline, tạo issue |
| DevOps | Quản lý workflow, environment secret, deploy rule |
| Release Manager | Approve release branch, production gate |
| Admin | Quản lý quyền repo, branch protection |

Production environment secret chỉ nên cho DevOps/Release Manager có quyền quản lý.

## 16. Branch protection rule

| Rule | `develop` | `main` |
| --- | --- | --- |
| Require PR | Có | Có |
| Require CI pass | Có | Có |
| Require review | Ít nhất 1 | Ít nhất 2 hoặc owner |
| Block force push | Có | Có |
| Block delete branch | Có | Có |
| Require signed commit | Nên có | Nên có/Có |
| Require status checks up to date | Có | Có |
| Require linear history | Tùy team | Nên có |

## 17. Checklist triển khai DEVOPS-02

### 17.1 Repository checklist

- [ ] Chốt monorepo hoặc multi-repo.
- [ ] Tạo cấu trúc thư mục chuẩn.
- [ ] Tạo CODEOWNERS nếu dùng GitHub/GitLab tương ứng.
- [ ] Tạo PR template.
- [ ] Tạo issue template cho bug/feature/hotfix.
- [ ] Tạo branch protection cho `develop` và `main`.
- [ ] Tạo tag/version convention.

### 17.2 CI checklist

- [ ] CI chạy trên PR.
- [ ] CI chạy lint, typecheck, unit test, build.
- [ ] Có secret scan.
- [ ] Có dependency scan tối thiểu.
- [ ] Có Docker build smoke.
- [ ] Có test report hoặc log đủ để QA/Dev đọc.
- [ ] Có cache dependency để pipeline không quá chậm.
- [ ] Không leak secret trong log.

### 17.3 Release traceability checklist

- [ ] Mỗi build có commit SHA.
- [ ] Mỗi image có tag không dùng `latest` cho production.
- [ ] Mỗi release có release note.
- [ ] Mỗi deployment biết được source branch/tag.
- [ ] Có link PR/issue liên quan.

## 18. Rủi ro và kiểm soát

| Rủi ro | Tác động | Kiểm soát |
| --- | --- | --- |
| Merge code chưa test | Lỗi staging/production | CI required + review |
| Secret bị commit | Lộ dữ liệu | Secret scan + review + rotate secret |
| Migration lỗi được merge | Hỏng DB staging/prod | Migration dry-run + review DB |
| Branch main bị push trực tiếp | Mất kiểm soát release | Branch protection |
| Không trace được image | Khó rollback | Tag theo SHA/version |
| PR quá lớn | Review thiếu sót | Chia PR theo module/feature nhỏ |

## 19. Open questions

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| DO02-OQ-001 | Dùng monorepo hay multi-repo cho MVP? | Tech Lead | Cao |
| DO02-OQ-002 | CI/CD platform chính là GitHub Actions, GitLab CI hay công cụ khác? | DevOps | Cao |
| DO02-OQ-003 | Có bắt buộc signed commit không? | Tech Lead | Trung bình |
| DO02-OQ-004 | Coverage threshold MVP là bao nhiêu? | QA/Tech Lead | Trung bình |
| DO02-OQ-005 | Có yêu cầu SBOM cho MVP không? | Security/DevOps | Thấp |

## 99. Tiêu chí nghiệm thu DEVOPS-02

| STT | Tiêu chí | Bắt buộc MVP |
| --- | --- | --- |
| 1 | Tài liệu nêu rõ mục tiêu, phạm vi và không phạm vi | Có |
| 2 | Có quy trình triển khai hoặc vận hành cụ thể | Có |
| 3 | Có checklist cho DevOps/Backend/Frontend/QA | Có |
| 4 | Có rule tách biệt môi trường local/dev/staging/production | Có |
| 5 | Có kiểm soát bảo mật, secret, permission hoặc access nếu liên quan | Có |
| 6 | Có rollback/fallback hoặc cách xử lý lỗi nếu liên quan | Có |
| 7 | Có mapping với QA/release readiness nếu liên quan | Có |
| 8 | Có open questions cần chốt trước production | Có |

---

## 100. Kết luận

**DEVOPS-02** hoàn thiện một phần quan trọng trong chuỗi DevOps MVP. Tài liệu này cần được dùng làm căn cứ khi viết script, pipeline, Dockerfile, cấu hình môi trường, checklist release và runbook vận hành thực tế.
