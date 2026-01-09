import { IsString, IsOptional } from 'class-validator';

export class UpdateTeamDto {
    @IsString()
    @IsOptional()
    teamName?: string;
}
