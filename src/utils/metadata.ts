import { collectFiles, getRelativePath, getRootDir } from '@zanix/helpers'
import { join } from '@std/path'

export const defineLocalMetadata = async (
  dir = '.',
  types = ['.handler.ts', '.interactor.ts', '.hoc.ts', '.connector.ts'],
) => {
  const imports: Promise<unknown>[] = []
  const relativePath = getRelativePath(getRootDir(), import.meta.dirname)
  collectFiles(dir, types, (path) => {
    imports.push(import(join(relativePath, path)))
  })

  await Promise.all(imports)
}

export const defineGlobalMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // TODO: add global imports, e.g: @zanix/auth/globalMiddlewares
  //imports.push(import('@zanix/server'))

  await Promise.all(imports)
}

export const defineAdminMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // TODO: add core imports, e.g: @zanix/auth/admin
  //imports.push(import('@zanix/server'))

  await Promise.all(imports)
}
