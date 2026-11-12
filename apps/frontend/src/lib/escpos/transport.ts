// Browser transports for sending raw ESC/POS bytes to thermal printers.
// Ported from surevax-pos's js/escpos-printing.js — field-tested against
// generic USB ESC/POS printers and BLE printers using Nordic UART /
// HM-10 / generic vendor services.

import { ESC_POS, sanitizeEscPosText } from './commands'

export type PrintCapabilities = {
  bluetooth: boolean
  usb: boolean
  serial: boolean
  mobile: boolean
  platform: string
}

// Minimal structural typings for Web Bluetooth / WebUSB / Web Serial.
// The full @types/web-bluetooth + @types/w3c-web-usb packages aren't
// installed; we feature-detect and narrow at the call sites.
type AnyNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (opts: {
      acceptAllDevices?: boolean
      optionalServices?: string[]
    }) => Promise<BluetoothDeviceLike>
  }
  usb?: {
    requestDevice: (opts: { filters: Array<Record<string, number>> }) => Promise<USBDeviceLike>
  }
  serial?: {
    requestPort: () => Promise<SerialPortLike>
  }
}

type BluetoothCharacteristicLike = {
  properties: { write?: boolean; writeWithoutResponse?: boolean }
  writeValue: (data: BufferSource) => Promise<void>
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>
}

type BluetoothServiceLike = {
  getCharacteristics: () => Promise<BluetoothCharacteristicLike[]>
}

type BluetoothServerLike = {
  getPrimaryService: (svcId: string) => Promise<BluetoothServiceLike>
  getPrimaryServices: () => Promise<BluetoothServiceLike[]>
}

type BluetoothDeviceLike = {
  gatt: { connect: () => Promise<BluetoothServerLike> }
  addEventListener: (event: string, handler: () => void) => void
}

type USBEndpointLike = { direction: 'in' | 'out'; endpointNumber: number }
type USBAlternateLike = { alternateSetting: number; endpoints: USBEndpointLike[] }
type USBInterfaceLike = { interfaceNumber: number; alternates: USBAlternateLike[] }
type USBConfigurationLike = { interfaces: USBInterfaceLike[] }
type USBDeviceLike = {
  configuration: USBConfigurationLike | null
  open: () => Promise<void>
  close: () => Promise<void>
  selectConfiguration: (n: number) => Promise<void>
  claimInterface: (n: number) => Promise<void>
  releaseInterface: (n: number) => Promise<void>
  selectAlternateInterface: (n: number, alt: number) => Promise<void>
  transferOut: (endpoint: number, data: BufferSource) => Promise<unknown>
}

type SerialPortLike = {
  open: (opts: {
    baudRate: number
    dataBits?: number
    stopBits?: number
    parity?: 'none' | 'even' | 'odd'
  }) => Promise<void>
  close: () => Promise<void>
  writable: {
    getWriter: () => { write: (data: BufferSource) => Promise<void>; releaseLock: () => void }
  }
}

function nav(): AnyNavigator {
  return navigator as AnyNavigator
}

function isMobileDevice(): boolean {
  const ua = navigator.userAgent ?? ''
  if (/android|iphone|ipad|ipod|iemobile|windows phone/i.test(ua)) return true
  if (typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 768) return true
  return false
}

export function getPrintCapabilities(): PrintCapabilities {
  const n = nav()
  return {
    bluetooth: 'bluetooth' in n && !!n.bluetooth,
    usb: 'usb' in n && !!n.usb,
    serial: 'serial' in n && !!n.serial,
    mobile: isMobileDevice(),
    platform: navigator.platform || 'Unknown',
  }
}

// ── USB ───────────────────────────────────────────────────────────────────
export async function printViaUSB(escPosData: string): Promise<void> {
  const n = nav()
  if (!n.usb) throw new Error('WebUSB not supported in this browser.')

  // Common printer class (0x07) + vendor-specific (0xFF) — many ESC/POS
  // devices use vendor-specific class.
  const device = await n.usb.requestDevice({
    filters: [{ classCode: 0x07 }, { classCode: 0xff }],
  })

  await device.open()
  if (device.configuration === null) {
    await device.selectConfiguration(1)
  }
  const config = device.configuration
  if (!config) throw new Error('USB device has no configuration.')

  const iface = config.interfaces.find((i) =>
    i.alternates.some((alt) => alt.endpoints.some((ep) => ep.direction === 'out')),
  )
  if (!iface) throw new Error('No suitable USB interface with OUT endpoint found.')

  const alt = iface.alternates[0]
  if (!alt) throw new Error('USB interface has no alternates.')
  await device.claimInterface(iface.interfaceNumber)
  if (alt.alternateSetting) {
    await device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting)
  }

  const outEndpoint = alt.endpoints.find((ep) => ep.direction === 'out')
  if (!outEndpoint) throw new Error('No OUT endpoint found on selected USB interface.')

  const encoder = new TextEncoder()
  const data = encoder.encode(sanitizeEscPosText(escPosData))
  const maxChunk = 512
  for (let i = 0; i < data.length; i += maxChunk) {
    const chunk = data.slice(i, Math.min(i + maxChunk, data.length))
    await device.transferOut(outEndpoint.endpointNumber, chunk)
  }
  // Best-effort cut at end.
  await device.transferOut(outEndpoint.endpointNumber, encoder.encode(ESC_POS.cutPaper()))

  try {
    await device.releaseInterface(iface.interfaceNumber)
  } catch {
    /* ignore */
  }
  try {
    await device.close()
  } catch {
    /* ignore */
  }
}

// ── Bluetooth (BLE) ───────────────────────────────────────────────────────
// Common ESC/POS BLE services. Vendors vary; we probe these first, then
// fall back to enumerating all primary services.
const BLE_PRINTER_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / TI
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
]

let cachedCharacteristic: BluetoothCharacteristicLike | null = null

async function findWritableCharacteristic(
  server: BluetoothServerLike,
): Promise<BluetoothCharacteristicLike | null> {
  const probe = async (service: BluetoothServiceLike) => {
    const cs = await service.getCharacteristics()
    for (const c of cs) {
      if (c.properties.writeWithoutResponse || c.properties.write) return c
    }
    return null
  }

  for (const svcId of BLE_PRINTER_SERVICES) {
    try {
      const svc = await server.getPrimaryService(svcId)
      const c = await probe(svc)
      if (c) return c
    } catch {
      /* service not present; skip */
    }
  }

  const services = await server.getPrimaryServices()
  for (const svc of services) {
    const c = await probe(svc)
    if (c) return c
  }
  return null
}

async function connectBluetoothPrinter(): Promise<BluetoothCharacteristicLike> {
  const n = nav()
  if (!n.bluetooth) throw new Error('Web Bluetooth not supported on this browser.')

  const device = await n.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  })

  device.addEventListener('gattserverdisconnected', () => {
    cachedCharacteristic = null
  })

  const server = await device.gatt.connect()
  const characteristic = await findWritableCharacteristic(server)
  if (!characteristic) throw new Error('No writable characteristic found on this device.')

  cachedCharacteristic = characteristic
  return characteristic
}

export async function printViaBluetooth(escPosData: string): Promise<void> {
  const characteristic = cachedCharacteristic ?? (await connectBluetoothPrinter())
  const encoder = new TextEncoder()
  const data = encoder.encode(sanitizeEscPosText(escPosData))

  // BLE payloads are small; chunk writes. Conservative 100 bytes.
  const maxChunk = 100
  for (let i = 0; i < data.length; i += maxChunk) {
    const chunk = data.slice(i, Math.min(i + maxChunk, data.length))
    if (
      characteristic.properties.writeWithoutResponse &&
      characteristic.writeValueWithoutResponse
    ) {
      await characteristic.writeValueWithoutResponse(chunk)
    } else {
      await characteristic.writeValue(chunk)
    }
    // Small delay to avoid overrun on some printers
    await new Promise((r) => setTimeout(r, 20))
  }
}

// ── Web Serial ────────────────────────────────────────────────────────────
export async function printViaSerial(escPosData: string): Promise<void> {
  const n = nav()
  if (!n.serial) throw new Error('Web Serial not supported on this browser.')

  const port = await n.serial.requestPort()
  await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' })

  const encoder = new TextEncoder()
  const data = encoder.encode(sanitizeEscPosText(escPosData))
  const writer = port.writable.getWriter()
  try {
    await writer.write(data)
  } finally {
    writer.releaseLock()
    await port.close()
  }
}

// ── Raw download ──────────────────────────────────────────────────────────
export function downloadRawESCPOS(escPosData: string, prefix = 'receipt'): void {
  const blob = new Blob([escPosData], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${prefix}_${Date.now()}.bin`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
