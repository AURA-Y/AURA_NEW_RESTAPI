import { IsString, IsOptional } from 'class-validator';

export class UpdateChannelDto {
    @IsString()
    @IsOptional()
    channelName?: string;
}
