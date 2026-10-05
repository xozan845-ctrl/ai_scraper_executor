import { IsUrl, IsString, MinLength, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Credenciales soportadas: headers (Authorization, Cookie, API keys). */
export class CredentialsDto {
  @ApiPropertyOptional({ description: 'Headers a enviar (Authorization/Cookie/...)', example: { Authorization: 'Bearer x' } })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

/** POST /api/v1/sessions — crea un "chat" sobre una URL. */
export class CreateSessionDto {
  @ApiProperty({ example: 'https://www.sevasaonline.com/' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiPropertyOptional({ type: CredentialsDto })
  @IsOptional()
  @IsObject()
  credentials?: CredentialsDto;
}

/** POST /api/v1/sessions/:id/messages — instrucción del usuario. */
export class SendMessageDto {
  @ApiProperty({ example: 'Obtén todos los productos con nombre, precio e imagen', minLength: 2 })
  @IsString()
  @MinLength(2)
  instruction!: string;
}
