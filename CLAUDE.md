# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AURA_NEW_RESTAPI is a NestJS REST API backend for the AURA video conferencing platform. It handles user authentication (JWT + Google OAuth), channel/room management, meeting reports with S3 storage, and GitHub Issue integration.

## Common Commands

```bash
bun install                # Install dependencies
bun run start:dev          # Development server with hot reload (port 3002)
bun run build              # Production build (nest build)
bun run start:prod         # Run production build

# Prisma (schema at prisma/schema.prisma, output to generated/prisma/)
bunx prisma generate       # Generate Prisma client after schema changes
bunx prisma db push        # Push schema changes to database
bunx prisma studio         # Open Prisma Studio GUI
```

## Architecture

### API Configuration
- Global prefix: `/restapi` (all routes prefixed)
- Default port: 3002
- ValidationPipe with `whitelist: true` and `forbidNonWhitelisted: true` - DTOs must explicitly define all accepted fields

### Module Structure

```
src/
├── auth/           # JWT authentication, Google OAuth, user management
├── channel/        # Channels, teams, join requests, member roles (OWNER/ADMIN/MEMBER)
├── room/           # Meeting rooms with topics, passwords, share links
├── reports/        # Meeting reports with S3 file storage, share scope (PUBLIC/TEAM/CHANNEL/PRIVATE)
├── github/         # GitHub App integration for Issues and Projects
│   ├── services/   # ActionItemService for parsing markdown action items
│   └── dto/        # Request/Response DTOs with class-validator
├── calendar/       # Google Calendar integration
├── recordings/     # Meeting recordings management
├── sse/            # Server-Sent Events for real-time updates
├── prisma/         # PrismaService wrapper
├── encryption/     # AES encryption for sensitive data (GitHub tokens)
└── secrets/        # AWS Secrets Manager integration
```

### Database
- **PostgreSQL** with dual ORM setup:
  - **Prisma** for schema management and migrations (schema at `prisma/schema.prisma`)
  - **TypeORM** for entity queries in some modules (synchronize disabled)
- Prisma client generated to `generated/prisma/` (not default location)
- Relation names use PascalCase (e.g., `room.Channel`, not `room.channel`)

### Key Entities
- **User**: Auth, Google/GitHub OAuth tokens, profile
- **Channel**: Organization containing teams and rooms, GitHub App settings (encrypted)
- **Room**: Meeting with topic, attendees, GitHub repo override
- **RoomReport**: Meeting summary with share scope and S3 files
- **ActionItemIssue**: Tracks GitHub Issues created from meeting action items

### GitHub Integration
- Uses GitHub App authentication with Installation Tokens
- Supports per-Channel custom GitHub Apps or a default server App
- Private keys and Installation IDs stored encrypted
- GitHub Projects v2 integration via GraphQL API

### Authentication
- JWT tokens with Passport strategy
- `JwtAuthGuard` applied via `@UseGuards(JwtAuthGuard)` on protected routes
- Google OAuth for calendar access (refresh tokens stored)
- GitHub account linking for Issue assignment

## Environment Variables

```env
PORT=3002
DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME, DB_SSL
JWT_SECRET, JWT_EXPIRES_IN
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  # For S3 and Secrets Manager
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_AUTH_REDIRECT_URI
GITHUB_APP_ID, GITHUB_PRIVATE_KEY  # Default GitHub App (fallback)
ENCRYPTION_KEY  # AES key for encrypting sensitive data
```

## NestJS Patterns

### Controller Route Ordering
More specific routes must be defined BEFORE generic parameter routes:
```typescript
// CORRECT order:
@Get('channels/:channelId/projects')   // Specific sub-path first
@Get('channels/:channelId')            // Generic :param route last
```

### DTO Validation
All request body fields must be declared in DTOs with class-validator decorators. Undeclared fields are rejected due to `forbidNonWhitelisted: true`.
