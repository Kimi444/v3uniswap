import { Order } from '@uniswap/uniswapx-sdk';
import axios from 'axios';
import Logger from 'bunyan';

import { OrderServiceProvider } from '.';

const ORDER_SERVICE_TIMEOUT_MS = 500;

export class UniswapXServiceProvider implements OrderServiceProvider {
  private log: Logger;

  constructor(_log: Logger, private uniswapxServiceUrl: string) {
    this.log = _log.child({ quoter: 'WebhookQuoter' });
  }

  async postOrder(order: Order, signature: string, quoteId?: string): Promise<void> {
    this.log.info({ orderHash: order.hash() }, 'Posting order to UniswapX Service');

    const axiosConfig = {
      timeout: ORDER_SERVICE_TIMEOUT_MS,
    };

    try {
      await axios.post(
        this.uniswapxServiceUrl,
        {
          encodedOrder: order.serialize(),
          signature: signature,
          chainId: order.chainId,
          quoteId: quoteId,
        },
        axiosConfig
      );
      this.log.info({ orderHash: order.hash() }, 'Order posted to UniswapX Service');
    } catch (e) {
      this.log.error({ error: e }, 'Error posting order to UniswapX Service');
    }
  }
}
