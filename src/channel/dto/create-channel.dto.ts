import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateChannelDto {
    @IsString()
    @IsNotEmpty()
    channelName: string;

    @IsString()
    @IsOptional()
    channelImg?: string;
}
