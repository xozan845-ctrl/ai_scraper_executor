import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** POST /api/v1/auth/register-first — registro del primer superadmin. */
export class RegisterFirstDto {
  @ApiProperty({ example: 'admin@miempresa.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, example: 'una-clave-larga-y-segura' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
