import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateTeamDto {
    @IsString()
    @IsNotEmpty()
    teamName: string;

    @IsUUID()
    @IsNotEmpty()
    channelId: string;
}
