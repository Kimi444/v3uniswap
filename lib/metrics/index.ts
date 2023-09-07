export enum MetricLoggerUnit {
  Minutes = 'Minutes',
  Seconds = 'Seconds',
  Milliseconds = 'Milliseconds',
  None = 'None',
}

export enum MetricNamespace {
  Uniswap = 'Uniswap',
}

export const MetricName = {
  DynamoDBRequest: (task: string) => {
    return `dynamo_request_${task}`;
  },
  DynamoRequestError: (reason: string) => {
    return `dynamo_request_error_${reason}`;
  },
  SynthOrdersEnabledCount: 'synth_orders_enabled_count',
  SynthOrdersDisabledCount: 'synth_orders_disabled_count',
  SynthOrdersCount: 'synth_orders_count',
  SynthOrdersProcessingTimeMs: 'synth_orders_processing_time_ms',
};

export const SyntheticSwitchMetricDimension = {
  Service: 'SyntheticSwitch',
};

export const FadeRateMetricDimension = {
  Service: 'FadeRate',
};