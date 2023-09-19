import Logger from 'bunyan';

import { calculateFillerFadeRates } from '../../lib/cron/fade-rate';
import { FadesRowType } from '../../lib/repositories';

const FADES_ROWS: FadesRowType[] = [
  { fillerAddress: '0x1', totalQuotes: 50, fadedQuotes: 10 },
  { fillerAddress: '0x2', totalQuotes: 50, fadedQuotes: 20 },
  { fillerAddress: '0x3', totalQuotes: 100, fadedQuotes: 5 },
];

const ADDRESS_TO_FILLER = new Map<string, string>([
  ['0x1', 'filler1'],
  ['0x2', 'filler1'],
  ['0x3', 'filler2'],
]);

// silent logger in tests
const logger = Logger.createLogger({ name: 'test' });
logger.level(Logger.FATAL);

describe('FadeRateCron test', () => {
  describe('calculateFillerFadeRates', () => {
    it('takes into account multiple filler addresses of the same filler', () => {
      expect(calculateFillerFadeRates(FADES_ROWS, ADDRESS_TO_FILLER, logger)).toEqual(
        new Map<string, number>([
          ['filler1', 0.3],
          ['filler2', 0.05],
        ])
      );
    });
  });
});
