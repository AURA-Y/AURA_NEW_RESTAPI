import { IsString, IsOptional, IsUrl } from 'class-validator';

export class UpdateChannelDto {
    @IsString()
    @IsOptional()
    channelName?: string;

    @IsUrl()
    @IsOptional()
    slackWebhookUrl?: string;
}
