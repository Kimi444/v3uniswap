import { MetricLoggerUnit } from '@uniswap/smart-order-router';
import Joi from 'joi';

import { Metric } from '../../../entities';
import { V2QuoteRequest } from '../../../entities/quote-request';
import { timestampInMstoSeconds } from '../../../util/time';
import { APIGLambdaHandler } from '../../base';
import { APIHandleRequestParams, ErrorResponse, Response } from '../../base/api-handler';
import { HardQuoteRequestBody, HardQuoteRequestBodyJoi } from '../schema';
import { ContainerInjected, RequestInjected } from './injector';

export class QuoteHandler extends APIGLambdaHandler<
  ContainerInjected,
  RequestInjected,
  HardQuoteRequestBody,
  void,
  null
> {
  public async handleRequest(
    params: APIHandleRequestParams<ContainerInjected, RequestInjected, HardQuoteRequestBody, void>
  ): Promise<ErrorResponse | Response<null>> {
    const {
      requestInjected: { log, metric },
      requestBody,
    } = params;
    const start = Date.now();

    metric.putMetric(Metric.QUOTE_REQUESTED, 1, MetricLoggerUnit.Count);

    const request = V2QuoteRequest.fromHardRequestBody(requestBody);

    // TODO: finalize on v2 metrics logging
    log.info({
      eventType: 'HardQuoteRequest',
      body: {
        requestId: request.requestId,
        tokenInChainId: request.tokenInChainId,
        tokenOutChainId: request.tokenInChainId,
        encoded: requestBody.encodedInnerOrder,
        sig: requestBody.innerSig,
        createdAt: timestampInMstoSeconds(start),
        createdAtMs: start.toString(),
      },
    });

    return {
      statusCode: 200,
      body: null,
    };
  }

  protected requestBodySchema(): Joi.ObjectSchema | null {
    return HardQuoteRequestBodyJoi;
  }

  protected requestQueryParamsSchema(): Joi.ObjectSchema | null {
    return null;
  }

  protected responseBodySchema(): Joi.ObjectSchema | null {
    return null;
  }
}