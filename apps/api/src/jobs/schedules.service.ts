import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  JobUrlRejectedError,
  ScheduleValidationError,
  type ScheduleCrudUseCases,
} from '@ai-scraper/application-execution';
import { SCHEDULE_USE_CASES } from './providers';
import { CreateScheduleDto } from './dto/schedule.dto';

/** Adaptador Nest de los casos de uso de schedules (compuestos en providers). */
@Injectable()
export class SchedulesService {
  constructor(@Inject(SCHEDULE_USE_CASES) private readonly useCases: ScheduleCrudUseCases) {}

  async create(dto: CreateScheduleDto, scope = 'anon') {
    try {
      return await this.useCases.create.execute({
        url: dto.url,
        instruction: dto.instruction,
        limits: dto.limits,
        ai: dto.ai,
        webhookUrl: dto.webhookUrl,
        render: dto.render,
        outputSchema: dto.outputSchema,
        intervalSec: dto.intervalSec,
        ...(dto.maxRuns !== undefined ? { maxRuns: dto.maxRuns } : {}),
        scope,
      });
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  list(scope = 'anon') {
    return this.useCases.queries.list(undefined, scope);
  }

  get(id: string, scope = 'anon') {
    return this.useCases.queries.findOne(id, scope);
  }

  pause(id: string, scope = 'anon') {
    return this.useCases.control.pause(id, scope);
  }

  resume(id: string, scope = 'anon') {
    return this.useCases.control.resume(id, scope);
  }

  remove(id: string, scope = 'anon') {
    return this.useCases.control.remove(id, scope);
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof JobUrlRejectedError || error instanceof ScheduleValidationError) {
      return new BadRequestException(error.message);
    }
    return error;
  }
}
