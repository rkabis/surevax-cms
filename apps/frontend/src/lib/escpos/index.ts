export { generateReceiptESCPOS } from './receipt'
export type { ClinicInfo } from './receipt'
export {
  downloadRawESCPOS,
  getPrintCapabilities,
  printViaBluetooth,
  printViaSerial,
  printViaUSB,
} from './transport'
export type { PrintCapabilities } from './transport'
