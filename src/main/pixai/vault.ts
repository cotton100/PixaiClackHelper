export interface VaultIO {
  read(): string | null
  write(value: string): void
  available(): boolean
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}
export class PixaiVault {
  private key = ''
  remembered = false
  constructor(private io: VaultIO) {
    const value = io.read()
    if (value) {
      try {
        if (io.available()) {
          this.key = this.validate(io.decrypt(Buffer.from(value, 'base64')))
          this.remembered = true
        }
      } catch {
        /* Never echo a decryption exception. */
      }
    }
  }
  private validate(key: string): string {
    if (
      typeof key !== 'string' ||
      !key.trim() ||
      key.length > 4096 ||
      /[^\x21-\x7e]/.test(key.trim())
    )
      throw new Error('API 키 형식을 확인해 주세요.')
    return key.trim()
  }
  available(): boolean {
    return this.io.available()
  }
  get(): string {
    return this.key
  }
  connect(key: string, remember: boolean): void {
    const valid = this.validate(key)
    if (remember && !this.available())
      throw new Error('OS 보호 저장을 사용할 수 없습니다. 저장 안 함으로 연결해 주세요.')
    try {
      this.io.write(remember ? Buffer.from(this.io.encrypt(valid)).toString('base64') : '')
    } catch {
      throw new Error('키 저장을 변경하지 못했습니다. 다시 연결해 주세요.')
    }
    this.key = valid
    this.remembered = remember
  }
  forget(): void {
    this.io.write('')
    this.key = ''
    this.remembered = false
  }
}
