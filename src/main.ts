import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('restapi');

  // CORS 설정
  app.enableCors({
    origin: ['http://localhost:3000', 'http://aura-fe-alb-367344373.ap-northeast-2.elb.amazonaws.com'],
    credentials: true,
  });

  // Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`API Backend server is running on http://localhost:${port}`);
}

bootstrap();
