<p align="center">
  <h1 align="center">AURA API Backend</h1>
  <p align="center"><strong>Authentication & Resource Management API</strong></p>
</p>

---

## Overview

사용자 인증, 채널 관리, 파일 스토리지를 담당하는 NestJS REST API 서버입니다.

---

## Features

| Feature | Description |
|---------|-------------|
| **인증** | JWT 기반 회원가입/로그인 |
| **Google OAuth** | 소셜 로그인 + 캘린더 연동 |
| **사용자 관리** | 프로필 CRUD, 역할 관리 |
| **채널 관리** | 팀/채널 생성, 멤버 초대 |
| **파일 관리** | S3 업로드/다운로드 |
| **회의 기록** | 회의록, 리포트 저장 |
| **캘린더 연동** | Google Calendar 일정 등록/조회 |

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | NestJS |
| **Language** | TypeScript |
| **ORM** | TypeORM |
| **Database** | PostgreSQL |
| **Auth** | Passport JWT |
| **Storage** | AWS S3 |
| **Validation** | class-validator |

---

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- PostgreSQL 15+

### Installation

```bash
# Install dependencies
bun install
# or
npm install
```

### Environment Variables

`.env` 파일 생성:

```env
# Server
PORT=3002
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=aura
DB_SSL=false

# JWT
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# AWS S3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=ap-northeast-2
S3_BUCKET=aura-raw-data-bucket

# Google OAuth (소셜 로그인 + 캘린더)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_AUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

### Database Setup

```bash
# Docker로 PostgreSQL 실행
docker run -d \
  --name aura-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=aura \
  -p 5432:5432 \
  postgres:15-alpine
```

### Development

```bash
# 개발 서버 실행
bun run start:dev
# or
npm run start:dev
```

서버: http://localhost:3002

### Build & Production

```bash
bun run build
bun run start:prod
```

---

## Project Structure

```
src/
├── main.ts                 # Entry point
├── app.module.ts           # Root module
│
├── auth/                   # 인증 모듈
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   └── dto/
│       ├── login.dto.ts
│       └── signup.dto.ts
│
├── users/                  # 사용자 모듈
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── entities/
│       └── user.entity.ts
│
├── channels/               # 채널 모듈
│   ├── channels.module.ts
│   ├── channels.controller.ts
│   ├── channels.service.ts
│   └── entities/
│       ├── channel.entity.ts
│       └── channel-member.entity.ts
│
├── meetings/               # 회의 기록 모듈
│   ├── meetings.module.ts
│   ├── meetings.controller.ts
│   └── entities/
│       └── meeting.entity.ts
│
├── files/                  # 파일 관리 모듈
│   ├── files.module.ts
│   ├── files.controller.ts
│   └── files.service.ts
│
└── common/                 # 공통 유틸리티
    ├── guards/
    │   └── jwt-auth.guard.ts
    ├── decorators/
    │   └── current-user.decorator.ts
    └── filters/
        └── http-exception.filter.ts
```

---

## API Endpoints

### Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/signup` | 회원가입 | - |
| `POST` | `/auth/login` | 로그인 | - |
| `GET` | `/auth/profile` | 내 프로필 | JWT |
| `PATCH` | `/auth/profile` | 프로필 수정 | JWT |
| `DELETE` | `/auth/withdraw` | 회원 탈퇴 | JWT |

### Google OAuth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/auth/google` | Google 로그인 URL 반환 | - |
| `GET` | `/auth/google/callback` | OAuth 콜백 처리 | - |
| `GET` | `/auth/google/status` | Google 연동 상태 확인 | JWT |

### Calendar

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/calendar/events` | 내 캘린더 일정 조회 | JWT |
| `POST` | `/calendar/events` | 회의 일정 등록 | JWT |
| `DELETE` | `/calendar/events/:eventId` | 일정 삭제 | JWT |

#### POST /auth/signup

```json
// Request
{
  "email": "user@example.com",
  "password": "password123",
  "name": "홍길동"
}

// Response
{
  "id": 1,
  "email": "user@example.com",
  "name": "홍길동",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### POST /auth/login

```json
// Request
{
  "email": "user@example.com",
  "password": "password123"
}

// Response
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "홍길동"
  }
}
```

### Channels

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/channels` | 내 채널 목록 | JWT |
| `POST` | `/channels` | 채널 생성 | JWT |
| `GET` | `/channels/:id` | 채널 상세 | JWT |
| `PATCH` | `/channels/:id` | 채널 수정 | JWT |
| `DELETE` | `/channels/:id` | 채널 삭제 | JWT |
| `POST` | `/channels/:id/members` | 멤버 초대 | JWT |

### Files

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/files/upload` | 파일 업로드 | JWT |
| `GET` | `/files/:id` | 파일 다운로드 URL | JWT |
| `DELETE` | `/files/:id` | 파일 삭제 | JWT |

### Meetings

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/meetings` | 회의 목록 | JWT |
| `GET` | `/meetings/:id` | 회의 상세 | JWT |
| `GET` | `/meetings/:id/report` | 회의록 조회 | JWT |

---

## Docker

### Build

```bash
docker build -t aura-api-backend .
```

### Run

```bash
docker run -p 3002:3002 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_USERNAME=postgres \
  -e DB_PASSWORD=postgres \
  -e DB_NAME=aura \
  -e JWT_SECRET=your-secret \
  aura-api-backend
```

### Docker Compose

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: aura
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  api-backend:
    build: .
    ports:
      - "3002:3002"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USERNAME: postgres
      DB_PASSWORD: postgres
      DB_NAME: aura
      DB_SSL: false
      JWT_SECRET: your-secret-key
      NODE_ENV: production
    depends_on:
      - postgres

volumes:
  postgres_data:
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | 개발 서버 (hot reload) |
| `npm run build` | 프로덕션 빌드 |
| `npm run start:prod` | 프로덕션 서버 |
| `npm run lint` | ESLint 실행 |
| `npm run test` | 테스트 실행 |

---

## Security Notes

- Production에서 `JWT_SECRET`은 반드시 강력한 랜덤 값 사용
- `DB_SSL=true`로 데이터베이스 연결 암호화
- 관리형 DB 서비스 (RDS) 사용 권장

---

## Related Services

| Service | Description | Port |
|---------|-------------|------|
| **AURA_FRONT** | Next.js Frontend | 3000 |
| **livekit-backend** | LiveKit Agent | 3001 |
| **api-backend** (this) | REST API | 3002 |
| **AURA_RAG** | RAG Server | 8000 |

---

## License

Private
