# Markets Ingest MVP (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить `GET /markets`, который возвращает срез маркетов из одного upstream-вызова Polymarket в стабильном DTO-контракте.

**Architecture:** `MarketsController` делегирует в `MarketsService`, который вызывает отдельный `PolymarketHttpClient` и маппит ответ в `MarketDto`. Ошибки upstream приводятся к единой карте статусов (`503/502`), а формат ответа стабилизируется через `MarketsResponseDto`.

**Tech Stack:** NestJS 11, TypeScript strict, встроенный `fetch` (Node), `@nestjs/testing`, Vitest.

---

## File Structure

### Create
- `src/polymarket/polymarket-http.client.ts` — HTTP-клиент Polymarket с таймаутом и типизированным результатом.
- `src/polymarket/dto/polymarket-market.raw.ts` — минимальный тип сырого upstream-маркета.
- `src/polymarket/polymarket-http.client.spec.ts` — unit-тесты HTTP-клиента (успех, timeout, 4xx/5xx).
- `src/markets/dto/market.dto.ts` — публичный DTO-контракт `MarketDto`.
- `src/markets/dto/markets-response.dto.ts` — DTO ответа `{ data, meta }`.
- `src/markets/market.mapper.ts` — преобразование сырого upstream-маркета в `MarketDto`.
- `src/markets/market.mapper.spec.ts` — unit-тесты маппера.
- `src/markets/markets.service.spec.ts` — unit-тесты сервиса (маппинг + ошибки).
- `src/markets/markets.controller.spec.ts` — тест контроллера на контракт и коды ошибок.
- `test/markets.e2e-spec.ts` — автоматизируемый smoke/e2e тест endpoint `GET /markets`.
- `vitest.config.ts` — конфигурация тест-раннера.

### Modify
- `package.json` — скрипты `test`, `test:watch`, devDependency для Vitest.
- `tsconfig.json` — добавить `vitest/globals` в `compilerOptions.types` для тестов.
- `src/polymarket/polymarket.module.ts` — зарегистрировать и экспортировать `PolymarketHttpClient`.
- `src/markets/markets.service.ts` — реализовать `getMarkets()` + маппинг + логирование + обработку ошибок.
- `src/markets/markets.controller.ts` — добавить `GET /markets`.
- `src/markets/markets.module.ts` — подключить `PolymarketModule`.

### Verify
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test -- test/markets.e2e-spec.ts`

---

### Task 1: Подготовка тестовой инфраструктуры

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Test: `npm run test`

- [ ] **Step 1: Добавить минимальный failing доменный тест**

Создать тест в `src/markets/markets.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("MarketsService", () => {
  it("creates test runtime", () => {
    expect("markets").toBe("trades");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm run test -- src/markets/markets.service.spec.ts`  
Expected: FAIL с `Expected 'markets' to be 'trades'`.

- [ ] **Step 3: Подключить Vitest и исправить тест**

Исправить ожидание:

```ts
expect("markets").toBe("markets");
```

И добавить конфиг:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    globals: true
  }
});
```

- [ ] **Step 4: Повторно запустить тест**

Run: `npm run test -- src/markets/markets.service.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/markets/markets.service.spec.ts
git commit -m "test: configure vitest for service and controller specs"
```

### Task 2: Polymarket HTTP client с таймаутом

**Files:**
- Create: `src/polymarket/dto/polymarket-market.raw.ts`
- Create: `src/polymarket/polymarket-http.client.ts`
- Create: `src/polymarket/polymarket-http.client.spec.ts`
- Modify: `src/polymarket/polymarket.module.ts`
- Test: `src/polymarket/polymarket-http.client.spec.ts`

- [ ] **Step 1: Написать failing unit-тесты клиента**

Добавить в `src/polymarket/polymarket-http.client.spec.ts` кейсы:
- `returns raw markets array on 200`,
- `throws timeout error`,
- `throws typed upstream error with status`.
- `throws on missing POLYMARKET_REST_URL`,
- `throws on missing POLYMARKET_MARKETS_PATH`,
- `uses 10000ms timeout for invalid POLYMARKET_HTTP_TIMEOUT_MS`.

- [ ] **Step 2: Запустить таргетный тест и убедиться, что падает**

Run: `npm run test -- src/polymarket/polymarket-http.client.spec.ts`  
Expected: FAIL минимум в 1-2 кейсах.

- [ ] **Step 3: Реализовать HTTP client и регистрацию в модуле**

Минимальная реализация клиента:

```ts
@Injectable()
export class PolymarketHttpClient {
  constructor(private readonly configService: ConfigService) {}

  async fetchMarkets(): Promise<PolymarketMarketRaw[]> {
    // URL: POLYMARKET_REST_URL + POLYMARKET_MARKETS_PATH
    // Таймаут: POLYMARKET_HTTP_TIMEOUT_MS, дефолт 10000
    // Обязательные env читать через getOrThrow
    // Невалидный timeout (NaN, <=0) -> fallback 10000
    // Ошибки 4xx/5xx возвращать как typed error со statusCode
  }
}
```

- [ ] **Step 4: Запустить таргетный тест**

Run: `npm run test -- src/polymarket/polymarket-http.client.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/polymarket/dto/polymarket-market.raw.ts src/polymarket/polymarket-http.client.ts src/polymarket/polymarket-http.client.spec.ts src/polymarket/polymarket.module.ts
git commit -m "feat(polymarket): add typed http client with timeout"
```

### Task 3: DTO и чистый mapper

**Files:**
- Create: `src/markets/dto/market.dto.ts`
- Create: `src/markets/dto/markets-response.dto.ts`
- Create: `src/markets/market.mapper.ts`
- Create: `src/markets/market.mapper.spec.ts`
- Test: `src/markets/market.mapper.spec.ts`

- [ ] **Step 1: Написать failing контрактный тест на структуру DTO**

Проверить, что `mapPolymarketMarket(raw)` формирует поля:
`id, slug, question, outcomes, active, closed, liquidity, volume24h, endDate`.

- [ ] **Step 2: Запустить тест и подтвердить падение**

Run: `npm run test -- src/markets/market.mapper.spec.ts -t "maps raw market to MarketDto"`  
Expected: FAIL (поля не сформированы).

- [ ] **Step 3: Описать DTO-типы и реализовать mapper**

```ts
export interface MarketDto {
  id: string;
  slug: string;
  question: string;
  outcomes: string[];
  active: boolean;
  closed: boolean;
  liquidity: number;
  volume24h: number;
  endDate: string | null;
}
```

```ts
export function mapPolymarketMarket(raw: PolymarketMarketRaw): MarketDto {
  // Явный маппинг сырого формата в публичный контракт
}
```

- [ ] **Step 4: Перезапустить тест**

Run: `npm run test -- src/markets/market.mapper.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/markets/dto/market.dto.ts src/markets/dto/markets-response.dto.ts src/markets/market.mapper.ts src/markets/market.mapper.spec.ts
git commit -m "feat(markets): define dto contract and pure mapper"
```

### Task 4: Реализация `MarketsService.getMarkets()`

**Files:**
- Modify: `src/markets/markets.service.ts`
- Test: `src/markets/markets.service.spec.ts`

- [ ] **Step 1: Добавить failing тест на успешный сценарий**

Тест: сервис получает 2 сырьевых маркета от клиента и возвращает:
- `data.length === 2`
- `meta.source === "polymarket"`
- `meta.total === 2`
- `meta.fetchedAt` — ISO строка.

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npm run test -- src/markets/markets.service.spec.ts -t "maps upstream markets to response"`  
Expected: FAIL.

- [ ] **Step 3: Реализовать минимальный рабочий код сервиса**

```ts
@Injectable()
export class MarketsService {
  private readonly logger = new Logger(MarketsService.name);

  async getMarkets(): Promise<MarketsResponseDto> {
    // log start
    // fetch from PolymarketHttpClient
    // map via mapPolymarketMarket()
    // return { data, meta }
    // map errors: 429/5xx/timeout -> 503, other 4xx -> 502
  }
}
```

- [ ] **Step 4: Запустить весь spec-файл сервиса**

Run: `npm run test -- src/markets/markets.service.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/markets/markets.service.ts src/markets/markets.service.spec.ts
git commit -m "feat(markets): implement markets mapping and upstream error policy"
```

### Task 5: Endpoint `GET /markets` в контроллере

**Files:**
- Modify: `src/markets/markets.controller.ts`
- Modify: `src/markets/markets.module.ts`
- Test: `src/markets/markets.controller.spec.ts`

- [ ] **Step 1: Написать failing controller-тест**

Проверить, что `GET /markets` вызывает `marketsService.getMarkets()` и возвращает контракт `{ data, meta }`.

- [ ] **Step 2: Запустить тест и подтвердить падение**

Run: `npm run test -- src/markets/markets.controller.spec.ts -t "returns markets response"`  
Expected: FAIL.

- [ ] **Step 3: Реализовать контроллер и модульную связку**

```ts
@Controller("markets")
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Get()
  getMarkets(): Promise<MarketsResponseDto> {
    return this.marketsService.getMarkets();
  }
}
```

Подключить `PolymarketModule` в `MarketsModule.imports`.

- [ ] **Step 4: Запустить controller-тест**

Run: `npm run test -- src/markets/markets.controller.spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/markets/markets.controller.ts src/markets/markets.module.ts src/markets/markets.controller.spec.ts
git commit -m "feat(markets): expose get markets endpoint"
```

### Task 6: Негативные сценарии и финальная верификация

**Files:**
- Modify: `src/markets/markets.service.spec.ts`
- Modify: `src/markets/markets.controller.spec.ts`

- [ ] **Step 1: Добавить failing тесты на карту ошибок**

Сценарии:
- upstream `429` -> `503`
- upstream `500` -> `503`
- upstream `400` -> `502`
- invalid payload -> `503`

- [ ] **Step 2: Запустить тесты и подтвердить падение**

Run: `npm run test -- src/markets/markets.service.spec.ts src/markets/markets.controller.spec.ts`  
Expected: FAIL минимум в 1-2 новых кейсах.

- [ ] **Step 3: Довести реализацию до прохождения**

Обновить обработку ошибок в `MarketsService` без расширения функциональности за рамки MVP.

- [ ] **Step 4: Запустить полный набор проверок**

Run: `npm run test`  
Expected: PASS

Run: `npm run lint`  
Expected: PASS

Run: `npm run typecheck`  
Expected: PASS

Run: `npm run start:dev`  
Then run: `curl -i http://localhost:3000/markets`  
Expected: `HTTP/1.1 200` и JSON с ключами `data` и `meta`.

- [ ] **Step 5: Commit**

```bash
git add src/markets/markets.service.spec.ts src/markets/markets.controller.spec.ts src/markets/markets.service.ts
git commit -m "test(markets): cover upstream failure matrix and invalid payload"
```

### Task 7: Автоматизируемый smoke/e2e для `GET /markets`

**Files:**
- Create: `test/markets.e2e-spec.ts`
- Modify: `vitest.config.ts`
- Test: `test/markets.e2e-spec.ts`

- [ ] **Step 1: Написать failing e2e-тест**

Поднять `INestApplication` через `Test.createTestingModule`, импортировать `AppModule`, замокать `PolymarketHttpClient`, выполнить `GET /markets` и проверить:
- статус `200`,
- наличие `data` и `meta` в ответе.

- [ ] **Step 2: Запустить e2e-тест и подтвердить падение**

Run: `npm run test -- test/markets.e2e-spec.ts`  
Expected: FAIL (нет моков/инициализации или неверный bootstrap теста).

- [ ] **Step 3: Реализовать e2e bootstrap и моки**

Пример основы:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [AppModule]
})
  .overrideProvider(PolymarketHttpClient)
  .useValue({ fetchMarkets: vi.fn().mockResolvedValue([rawMarket]) })
  .compile();
```

- [ ] **Step 4: Перезапустить e2e-тест**

Run: `npm run test -- test/markets.e2e-spec.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/markets.e2e-spec.ts vitest.config.ts
git commit -m "test(e2e): add markets endpoint smoke coverage"
```

---

## Notes for Executor

- Использовать `@superpowers/test-driven-development` в каждой задаче с тестами.
- Перед финальным статусом “готово” обязательно применить `@superpowers/verification-before-completion`.
- Env-конфиг для HTTP-клиента:
  - `POLYMARKET_REST_URL` (обязательный),
  - `POLYMARKET_MARKETS_PATH` (обязательный),
  - `POLYMARKET_HTTP_TIMEOUT_MS` (необязательный, по умолчанию `10000`).
- Не добавлять БД, кэш, пагинацию и BullMQ в этом плане (YAGNI).
- Комментарии в коде писать на русском только там, где без комментария неочевидная логика.
