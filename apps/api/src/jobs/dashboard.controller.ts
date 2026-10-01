import { Controller, Get, Header } from '@nestjs/common';
import { DASHBOARD_HTML } from '../dashboard/dashboard';

/** Dashboard FASE 9: SPA estática (sin build) sobre la API §42. */
@Controller('dashboard')
export class DashboardController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    return DASHBOARD_HTML;
  }
}
