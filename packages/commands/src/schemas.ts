/**
 * DSL de scraping §24-25. La IA solo puede emitir estos comandos.
 * El Execution Engine los traduce a Crawlee. Nunca eval() ni page.evaluate libre (§4).
 */
import { z } from 'zod';

export const CommandType = {
  NAVIGATE: 'NAVIGATE',
  INSPECT_PAGE: 'INSPECT_PAGE',
  INSPECT_LINKS: 'INSPECT_LINKS',
  INSPECT_ELEMENTS: 'INSPECT_ELEMENTS',
  CLICK: 'CLICK',
  TYPE: 'TYPE',
  AUTHENTICATE: 'AUTHENTICATE',
  WAIT: 'WAIT',
  SCROLL: 'SCROLL',
  EXTRACT: 'EXTRACT',
  EXTRACT_LIST: 'EXTRACT_LIST',
  GET_ATTRIBUTE: 'GET_ATTRIBUTE',
  FOLLOW_LINKS: 'FOLLOW_LINKS',
  PAGINATE: 'PAGINATE',
  FINISH: 'FINISH',
} as const;

export type CommandType = (typeof CommandType)[keyof typeof CommandType];

const BaseCommand = z.object({
  type: z.nativeEnum(CommandType),
  reason: z.string().optional(),
});

const NavigateCommand = BaseCommand.extend({
  type: z.literal(CommandType.NAVIGATE),
  url: z.string().url(),
});

const ClickCommand = BaseCommand.extend({
  type: z.literal(CommandType.CLICK),
  selector: z.string().min(1).max(500),
});

const TypeCommand = BaseCommand.extend({
  type: z.literal(CommandType.TYPE),
  selector: z.string().min(1).max(500),
  text: z.string().max(5000).optional(),
  credential: z.enum(['username', 'password']).optional(),
});

const AuthenticateCommand = BaseCommand.extend({
  type: z.literal(CommandType.AUTHENTICATE),
  usernameSelector: z.string().min(1).max(500),
  passwordSelector: z.string().min(1).max(500),
  submitSelector: z.string().min(1).max(500).optional(),
  successSelector: z.string().min(1).max(500).optional(),
  captchaSelector: z.string().min(1).max(500).optional(),
  mfaSelector: z.string().min(1).max(500).optional(),
});

const ExtractField = z.union([
  z.string(),
  z.object({ selector: z.string(), attribute: z.string().optional() }),
]);

const ExtractListCommand = BaseCommand.extend({
  type: z.literal(CommandType.EXTRACT_LIST),
  selector: z.string().min(1),
  fields: z.record(ExtractField),
  limit: z.number().int().positive().max(1000).optional(),
});

const ExtractCommand = BaseCommand.extend({
  type: z.literal(CommandType.EXTRACT),
  fields: z.record(ExtractField),
});

const PaginateCommand = BaseCommand.extend({
  type: z.literal(CommandType.PAGINATE),
  selector: z.string().optional(),
  pattern: z.string().optional(), // e.g. "?page=N"
  maxPages: z.number().int().positive().max(500).optional(),
});

const FollowLinksCommand = BaseCommand.extend({
  type: z.literal(CommandType.FOLLOW_LINKS),
  selector: z.string().min(1),
  maxLinks: z.number().int().positive().max(500).optional(),
  sameDomainOnly: z.boolean().default(true),
});

export const ScrapingCommandSchema = z.discriminatedUnion('type', [
  NavigateCommand,
  ClickCommand,
  TypeCommand,
  AuthenticateCommand,
  ExtractListCommand,
  ExtractCommand,
  PaginateCommand,
  FollowLinksCommand,
  z.object({ type: z.literal('INSPECT_PAGE') }).passthrough(),
  z.object({ type: z.literal('INSPECT_LINKS') }).passthrough(),
  z.object({ type: z.literal('INSPECT_ELEMENTS') }).passthrough(),
  z.object({ type: z.literal('SCROLL') }).passthrough(),
  z.object({ type: z.literal('WAIT') }).passthrough(),
  z.object({ type: z.literal('GET_ATTRIBUTE') }).passthrough(),
  z.object({ type: z.literal('FINISH') }).passthrough(),
]);

export type ScrapingCommand = z.infer<typeof ScrapingCommandSchema>;

export const ScrapingPlanSchema = z.object({
  version: z.literal('1.0'),
  actions: z.array(ScrapingCommandSchema).min(1).max(50),
});

export type ScrapingPlan = z.infer<typeof ScrapingPlanSchema>;
