# API Backend

사용자 인증 및 관리를 위한 NestJS REST API 서버

## 기능

- 사용자 회원가입
- 사용자 로그인
- JWT 인증
- 사용자 프로필 관리

## 기술 스택

- NestJS
- TypeORM
- PostgreSQL
- JWT Authentication
- Passport

## 환경 변수

`.env` 파일을 생성하고 다음 변수를 설정하세요:

```bash
# Server
PORT=3002
NODE_ENV=production

# Database
DB_HOST=your-postgres-host
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-db-password
DB_NAME=aura
DB_SSL=true

# JWT
JWT_SECRET=your-secret-key-change-this
JWT_EXPIRES_IN=7d
```

## 로컬 개발

### 1. PostgreSQL 설치 및 실행

```bash
# Docker로 PostgreSQL 실행
docker run -d \
  --name postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=aura \
  -p 5432:5432 \
  postgres:15-alpine
```

### 2. 애플리케이션 실행

```bash
# 의존성 설치
bun install

# 개발 모드 실행
bun run start:dev

# 빌드
bun run build

# 프로덕션 모드 실행
bun run start:prod
```

## Docker 실행

### 이미지 빌드

```bash
docker build -t api-backend .
```

### 컨테이너 실행

```bash
docker run -p 3002:3002 \
  -e DB_HOST=your-postgres-host \
  -e DB_PORT=5432 \
  -e DB_USERNAME=postgres \
  -e DB_PASSWORD=your-password \
  -e DB_NAME=aura \
  -e DB_SSL=true \
  -e JWT_SECRET=your-secret \
  api-backend
```

## Docker Compose 예시

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: aura
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

## API 엔드포인트

### POST /auth/signup
회원가입

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}
```

### POST /auth/login
로그인

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGc...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name"
  }
}
```

### GET /auth/profile
프로필 조회 (인증 필요)

**Headers:**
```
Authorization: Bearer {access_token}
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "User Name"
}
```

## 배포

### AWS/GCP/Azure 등에 배포

1. Docker 이미지 빌드 및 푸시
```bash
docker build -t your-registry/api-backend:latest .
docker push your-registry/api-backend:latest
```

2. 서버에서 실행
```bash
docker pull your-registry/api-backend:latest
docker run -d \
  --name api-backend \
  -p 3002:3002 \
  --env-file .env \
  your-registry/api-backend:latest
```

## 주의사항

- Production 환경에서는 반드시 `.env` 파일의 `JWT_SECRET`을 강력한 값으로 변경 필요
- `DB_SSL=true`로 설정하여 데이터베이스 연결 보안을 강화하세요
- PostgreSQL은 별도의 서버나 관리형 데이터베이스 서비스 사용을 권장합니다
