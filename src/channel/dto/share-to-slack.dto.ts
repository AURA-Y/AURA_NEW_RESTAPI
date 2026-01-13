import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ShareToSlackDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    summary: string;

    @IsString()
    @IsOptional()
    date?: string;

    @IsString({ each: true })
    @IsOptional()
    attendees?: string[];
}
