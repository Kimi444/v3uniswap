import {
  DescribeStatementCommand,
  ExecuteStatementCommand,
  RedshiftDataClient,
  StatusString,
} from '@aws-sdk/client-redshift-data';
import Logger from 'bunyan';

import { SynthSwitchQueryParams, SynthSwitchTrade } from '../handlers/synth-switch';
import { checkDefined } from '../preconditions/preconditions';
import { WebhookConfiguration } from '../providers';
import { sleep } from '../util/time';

export * from './analytics-repository';

export type SharedConfigs = {
  Database: string;
  ClusterIdentifier: string;
  SecretArn: string;
};

export type ExecutionConfigs = {
  waitTimeMs: number;
};

export enum TimestampThreshold {
  TWO_WEEKS = "'2 WEEKS'",
  ONE_MONTH = "'1 MONTH'",
  TWO_MONTHS = "'2 MONTHS'",
}

export abstract class BaseRedshiftRepository {
  constructor(readonly client: RedshiftDataClient, private readonly configs: SharedConfigs) {}

  async executeStatement(sql: string, log: Logger, executionConfigs?: ExecutionConfigs): Promise<string> {
    const response = await this.client.send(new ExecuteStatementCommand({ ...this.configs, Sql: sql }));
    const stmtId = checkDefined(response.Id);

    for (;;) {
      const status = await this.client.send(new DescribeStatementCommand({ Id: stmtId }));
      if (status.Error) {
        log.error({ error: status.Error }, 'Failed to execute command');
        throw new Error(status.Error);
      }
      if (status.Status === StatusString.ABORTED || status.Status === StatusString.FAILED) {
        log.error({ error: status.Error }, 'Failed to execute command');
        throw new Error(status.Error);
      } else if (
        status.Status === StatusString.PICKED ||
        status.Status === StatusString.STARTED ||
        status.Status === StatusString.SUBMITTED
      ) {
        await sleep(executionConfigs?.waitTimeMs ?? 2000);
      } else if (status.Status === StatusString.FINISHED) {
        log.info({ sql }, 'Command finished');
        return stmtId;
      } else {
        log.error({ error: status.Error }, 'Unknown status');
        throw new Error(status.Error);
      }
    }
  }
}

export interface BaseSwitchRepository {
  putSynthSwitch(trade: SynthSwitchTrade, lower: string, enabled: boolean): Promise<void>;
  syntheticQuoteForTradeEnabled(trade: SynthSwitchQueryParams): Promise<boolean>;
}

export interface BaseConfigsRepository {
  getWebhookConfigurations(): Promise<WebhookConfiguration[]>;
  updateWebhookConfigurations(configs: WebhookConfiguration[]): Promise<void>;
}
