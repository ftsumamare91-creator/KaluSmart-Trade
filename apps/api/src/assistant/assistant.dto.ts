import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AskAssistantDto {
  @IsOptional() @IsString() @MaxLength(4000) message?: string;
  @IsOptional() @IsIn(['en', 'am', 'om', 'ti', 'auto']) language?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) history?: { role: 'user' | 'assistant'; content: string }[];
  @IsOptional() @IsArray() @ArrayMaxSize(5) attachments?: { name: string; mime: string; data_base64: string }[];
}
