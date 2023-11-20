import { TradeType } from '@uniswap/sdk-core';
import axios from 'axios';
import { ethers } from 'ethers';

import { QuoteRequest, AnalyticsEventType, WebhookResponseType } from '../../../lib/entities';
import { MockWebhookConfigurationProvider } from '../../../lib/providers';
import { MockCircuitBreakerConfigurationProvider } from '../../../lib/providers/circuit-breaker/mock';
import { MockFillerComplianceConfigurationProvider } from '../../../lib/providers/compliance';
import { WebhookQuoter } from '../../../lib/quoters';
import { FirehoseLogger } from '../../../lib/repositories/firehose-repository';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const QUOTE_ID = 'a83f397c-8ef4-4801-a9b7-6e79155049f6';
const REQUEST_ID = 'a83f397c-8ef4-4801-a9b7-6e79155049f6';
const SWAPPER = '0x0000000000000000000000000000000000000000';
const TOKEN_IN = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const TOKEN_OUT = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const CHAIN_ID = 1;
const FILLER = '0x0000000000000000000000000000000000000001';

const WEBHOOK_URL = 'https://uniswap.org';
const WEBHOOK_URL_ONEINCH = 'https://1inch.io';
const WEBHOOK_URL_SEARCHER = 'https://searcher.com';

const emptyMockComplianceProvider = new MockFillerComplianceConfigurationProvider([]);
const mockComplianceProvider = new MockFillerComplianceConfigurationProvider([{
  endpoints: ['https://uniswap.org', 'google.com'], addresses: [SWAPPER]
}]);
const logger = { child: () => logger, info: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
const mockFirehoseLogger = new FirehoseLogger(logger, "arn:aws:deliverystream/dummy", true);
const spySendAnalyticsEvent = jest.spyOn(mockFirehoseLogger, 'sendAnalyticsEvent');
async function assertSuccessfulFirehosePut() {
  const resultPromises = spySendAnalyticsEvent.mock.results.map(result => result.value);
  const results = await Promise.all(resultPromises);
  results.forEach((value) => {
    expect(value.statusCode).toEqual(200);
  });
}

describe('WebhookQuoter tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const webhookProvider = new MockWebhookConfigurationProvider([
    { name: 'uniswap', endpoint: WEBHOOK_URL, headers: {}, hash: "0xuni" },
    { name: '1inch', endpoint: WEBHOOK_URL_ONEINCH, headers: {}, hash: "0x1inch" },
    { name: 'searcher', endpoint: WEBHOOK_URL_SEARCHER, headers: {}, hash: "0xsearcher" },
  ]);
  const circuitBreakerProvider = new MockCircuitBreakerConfigurationProvider([
    { hash: '0xuni', fadeRate: 0.05, enabled: true },
    { hash: '0x1inch', fadeRate: 0.5, enabled: false },
    { hash: '0xsearcher', fadeRate: 0.1, enabled: true },
  ]);
  const webhookQuoter = new WebhookQuoter(logger, mockFirehoseLogger, webhookProvider, circuitBreakerProvider, emptyMockComplianceProvider);

  const request = new QuoteRequest({
    tokenInChainId: CHAIN_ID,
    tokenOutChainId: CHAIN_ID,
    requestId: REQUEST_ID,
    swapper: SWAPPER,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amount: ethers.utils.parseEther('1'),
    type: TradeType.EXACT_INPUT,
    numOutputs: 1,
  });

  const quote = {
    amountOut: ethers.utils.parseEther('2').toString(),
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amount.toString(),
    swapper: request.swapper,
    chainId: request.tokenInChainId,
    requestId: request.requestId,
    quoteId: QUOTE_ID,
    filler: FILLER,
  };

  const sharedWebhookResponseEventProperties = {
    requestId: expect.any(String),
    quoteId: expect.any(String),
    name: 'uniswap',
    endpoint: WEBHOOK_URL,
    requestTime: expect.any(Number),
    timeoutSettingMs: 500,
    responseTime: expect.any(Number),
    latencyMs: expect.any(Number),
  };

  it('Simple request and response', async () => {
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    }).mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: {
          ...quote,
          tokenIn: request.tokenOut,
          tokenOut: request.tokenIn,        
        }
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(response.length).toEqual(1);
    expect(response[0].toResponseJSON()).toEqual({ ...quote, quoteId: expect.any(String) });
  });
  
  it('Respects filler compliance requirements', async () => {
    const webhookQuoter = new WebhookQuoter(
      logger,
      mockFirehoseLogger,
      webhookProvider,
      circuitBreakerProvider,
      mockComplianceProvider,
    );

    await expect(webhookQuoter.quote(request)).resolves.toStrictEqual([]);
  });

  // should only call 'uniswap' and 'searcher' given they are enabled in the config
  it('Only calls to eligible endpoints', async () => {
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    }).mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: {
          ...quote,
          tokenIn: request.tokenOut,
          tokenOut: request.tokenIn,        
        }
      });
    });
    await webhookQuoter.quote(request);

    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL_SEARCHER,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).not.toBeCalledWith(WEBHOOK_URL_ONEINCH, request.toCleanJSON(), {
      headers: {},
      timeout: 500,
    });
  });

  it('Allows those in allow list even when they are disabled in the config', async () => {
    const webhookQuoter = new WebhookQuoter(
      logger,
      mockFirehoseLogger,
      webhookProvider,
      circuitBreakerProvider,
      emptyMockComplianceProvider,
      new Set<string>(['0x1inch'])
    );
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    });

    await webhookQuoter.quote(request);
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL_SEARCHER,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL_ONEINCH,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
  });

  it('Defaults to allowing endpoints not on circuit breaker config', async () => {
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    });
    const cbProvider = new MockCircuitBreakerConfigurationProvider([
      { hash: '0xuni', fadeRate: 0.05, enabled: true },
    ]);
    const quoter = new WebhookQuoter(logger, mockFirehoseLogger, webhookProvider, cbProvider, emptyMockComplianceProvider);
    await quoter.quote(request);
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL_SEARCHER,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL_ONEINCH,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      {
        headers: {},
        timeout: 500,
      }
    );
  });

  it('Simple request and response no swapper', async () => {
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    }).mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: {
          ...quote,
          tokenIn: request.tokenOut,
          tokenOut: request.tokenIn,        
        }
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(response.length).toEqual(1);
    expect(response[0].toResponseJSON()).toEqual({ ...quote, swapper: request.swapper, quoteId: expect.any(String) });
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL,
      { quoteId: expect.any(String), ...request.toOpposingCleanJSON() },
      { headers: {}, timeout: 500 }
    );
    expect(mockedAxios.post).toBeCalledWith(
      WEBHOOK_URL,
      { quoteId: expect.any(String), ...request.toCleanJSON() },
      { headers: {}, timeout: 500 }
    );
  });

  it('Simple request and response null swapper', async () => {
    const quote = {
      amountOut: ethers.utils.parseEther('2').toString(),
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amount.toString(),
      chainId: request.tokenInChainId,
      requestId: request.requestId,
      quoteId: QUOTE_ID,
      swapper: null,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    }).mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: {
          ...quote,
          tokenIn: request.tokenOut,
          tokenOut: request.tokenIn,        
        }
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(response.length).toEqual(1);
    expect(response[0].toResponseJSON()).toEqual({ ...quote, swapper: request.swapper, quoteId: expect.any(String) });
  });

  it('Simple request and response with explicit chainId', async () => {
    const provider = new MockWebhookConfigurationProvider([
      { name: 'uniswap', endpoint: WEBHOOK_URL, headers: {}, chainIds: [1], hash: "0xuni" },
    ]);
    const quoter = new WebhookQuoter(logger, mockFirehoseLogger, provider, circuitBreakerProvider, emptyMockComplianceProvider);
    const quote = {
      amountOut: ethers.utils.parseEther('2').toString(),
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amount.toString(),
      swapper: request.swapper,
      chainId: request.tokenInChainId,
      requestId: request.requestId,
      quoteId: QUOTE_ID,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
      });
    }).mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: {
          ...quote,
          tokenIn: request.tokenOut,
          tokenOut: request.tokenIn,        
        }
      });
    });
    const response = await quoter.quote(request);

    expect(response.length).toEqual(1);
    expect(response[0].toResponseJSON()).toEqual({ ...quote, quoteId: expect.any(String) });
  });

  it('Skips if chainId not configured', async () => {
    const provider = new MockWebhookConfigurationProvider([
      { name: 'uniswap', endpoint: WEBHOOK_URL, headers: {}, chainIds: [4, 5, 6], hash: "0xuni" },
    ]);
    const quoter = new WebhookQuoter(logger, mockFirehoseLogger, provider, circuitBreakerProvider, emptyMockComplianceProvider);

    const response = await quoter.quote(request);

    expect(response.length).toEqual(0);

    expect(logger.debug).toHaveBeenCalledWith(
      {
        configuredChainIds: [4, 5, 6],
        chainId: request.tokenInChainId,
      },
      `chainId not configured for ${WEBHOOK_URL}`
    );
  });

  it('Invalid quote response from webhook, missing amountIn', async () => {
    const quote = {
      amountOut: ethers.utils.parseEther('2').toString(),
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      swapper: request.swapper,
      chainId: request.tokenInChainId,
      requestId: request.requestId,
      quoteId: QUOTE_ID,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
        status: 200,
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(spySendAnalyticsEvent).toHaveBeenCalledWith(
      {
        eventType: AnalyticsEventType.WEBHOOK_RESPONSE,
        eventProperties: {
          ...sharedWebhookResponseEventProperties,
          status: 200,
          data: quote,
          responseType: WebhookResponseType.VALIDATION_ERROR,
          validationError: [
            {
              context: { key: 'amountIn', label: 'amountIn' },
              message: '"amountIn" is required',
              path: ['amountIn'],
              type: 'any.required',
            },
          ],
        }
      },
    );
    assertSuccessfulFirehosePut();
    expect(response).toEqual([]);
  });

  it('Invalid quote response from webhook, request/response mismatched requestId', async () => {
    const quote = {
      amountOut: ethers.utils.parseEther('2').toString(),
      amountIn: request.amount.toString(),
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      swapper: request.swapper,
      chainId: request.tokenInChainId,
      requestId: 'a83f397c-8ef4-4801-a9b7-6e7915504420',
      quoteId: QUOTE_ID,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
        status: 200,
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(spySendAnalyticsEvent).toHaveBeenCalledWith(
      {
        eventType: AnalyticsEventType.WEBHOOK_RESPONSE,
        eventProperties: {
          ...sharedWebhookResponseEventProperties,
          status: 200,
          data: quote,
          responseType: WebhookResponseType.REQUEST_ID_MISMATCH,
          mismatchedRequestId: quote.requestId,
        }
      },
    );
    assertSuccessfulFirehosePut();
    expect(response).toEqual([]);
  });

  it('Counts as non-quote if response returns 404', async () => {
    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: '',
        status: 404,
      });
    });
    const response = await webhookQuoter.quote(request);
    expect(spySendAnalyticsEvent).toHaveBeenCalledWith(
      {
        eventType: AnalyticsEventType.WEBHOOK_RESPONSE,
        eventProperties: {
          ...sharedWebhookResponseEventProperties,
          status: 404,
          data: '',
          responseType: WebhookResponseType.NON_QUOTE,
        }
      },
    );
    assertSuccessfulFirehosePut();
    expect(response.length).toEqual(0);
  });

  it('Counts as non-quote if response is zero exactInput', async () => {
    const quote = {
      amountOut: '0',
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amount.toString(),
      swapper: request.swapper,
      chainId: request.tokenInChainId,
      requestId: request.requestId,
      quoteId: QUOTE_ID,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
        status: 200,
      });
    });
    const response = await webhookQuoter.quote(request);

    expect(response.length).toEqual(0);
    expect(spySendAnalyticsEvent).toHaveBeenCalledWith(
      {
        eventType: AnalyticsEventType.WEBHOOK_RESPONSE,
        eventProperties: {
          ...sharedWebhookResponseEventProperties,
          status: 200,
          data: quote,
          responseType: WebhookResponseType.NON_QUOTE,
        }
      },
    );
    assertSuccessfulFirehosePut();
  });

  it('Counts as non-quote if response is zero exactOutput', async () => {
    const quote = {
      amountOut: request.amount.toString(),
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: '0',
      swapper: request.swapper,
      chainId: request.tokenInChainId,
      requestId: request.requestId,
      quoteId: QUOTE_ID,
      filler: FILLER,
    };

    mockedAxios.post.mockImplementationOnce((_endpoint, _req, _options) => {
      return Promise.resolve({
        data: quote,
        status: 200,
      });
    });
    const response = await webhookQuoter.quote(
      new QuoteRequest({
        tokenInChainId: CHAIN_ID,
        tokenOutChainId: CHAIN_ID,
        requestId: REQUEST_ID,
        swapper: SWAPPER,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        amount: ethers.utils.parseEther('1'),
        type: TradeType.EXACT_OUTPUT,
        numOutputs: 1,
      })
    );

    expect(response.length).toEqual(0);
    expect(spySendAnalyticsEvent).toHaveBeenCalledWith(
      {
        eventType: AnalyticsEventType.WEBHOOK_RESPONSE,
        eventProperties: {
          ...sharedWebhookResponseEventProperties,
          status: 200,
          data: quote,
          responseType: WebhookResponseType.NON_QUOTE,
        }
      },
    );
    assertSuccessfulFirehosePut();
  });
});
