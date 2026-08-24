export interface CliIntegrationStatus {
  available: boolean
  command: string | null
  detail: string
}

export interface VirtualPrinterStatus {
  supported: boolean
  registered: boolean
  backend_installed: boolean
  configured: boolean
  backend_path: string | null
  detail: string
}

export interface McpIntegrationStatus {
  available: boolean
  command: string
  protocol_version: string
  detail: string
}

export interface RuntimeIntegrationStatus {
  debug_build: boolean
  devtools_available: boolean
  plugins: string[]
}

export interface IntegrationStatus {
  platform: string
  cli: CliIntegrationStatus
  virtual_printer: VirtualPrinterStatus
  mcp_server: McpIntegrationStatus
  runtime: RuntimeIntegrationStatus
}
