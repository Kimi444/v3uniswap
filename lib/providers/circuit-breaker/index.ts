export interface CircuitBreakerConfiguration {
  hash: string;
  fadeRate: number;
  enabled: boolean;
}

export interface CircuitBreakerConfigurationProvider {
  getConfigurations(): Promise<CircuitBreakerConfiguration[]>;
}
