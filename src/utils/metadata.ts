import { collectFiles, getRootDir } from '@zanix/helpers'
import { ZANIX_SERVER_MODULES } from '@zanix/server'
import { join } from '@std/path'

export const defineLocalMetadata = async (
  dir = '.',
  types = ZANIX_SERVER_MODULES,
) => {
  const imports: Promise<unknown>[] = []

  const rootFilePath = `file://${getRootDir()}`
  collectFiles(dir, types, (path) => {
    imports.push(import(join(rootFilePath, path)))
  })

  await Promise.all(imports)
}

export const defineCoreMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // Loading Zanix datamaster core
  imports.push(import('@zanix/datamaster'))
  // Loading Zanix auth core
  imports.push(import('@zanix/auth'))
  // Loading Zanix notifications core
  imports.push(import('@zanix/notifications'))
  // Loading Zanix asyncmq core
  imports.push(import('@zanix/asyncmq'))

  await Promise.all(imports)
}

export const defineAdminMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // TODO: add core imports, e.g: @zanix/auth/admin DEFINE A SAME MODULE FOR ALL
  //imports.push(import('@zanix/server'))

  await Promise.all(imports)
}
