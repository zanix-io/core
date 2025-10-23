import { collectFiles, getRootDir } from '@zanix/helpers'
import { join } from '@std/path'

export const defineLocalMetadata = async (
  dir = '.',
  types = ['.handler.ts', '.interactor.ts', '.hoc.ts', '.connector.ts'],
) => {
  const imports: Promise<unknown>[] = []

  const rootFilePath = `file://${getRootDir()}`
  collectFiles(dir, types, (path) => {
    imports.push(import(join(rootFilePath, path)))
  })

  await Promise.all(imports)
}

export const defineCorelMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // TODO: add global imports, e.g: @zanix/auth/globalMiddlewares DEFINE A SAME MODULE FOR ALL
  //imports.push(import('@zanix/server'))

  await Promise.all(imports)
}

export const defineAdminMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // TODO: add core imports, e.g: @zanix/auth/admin DEFINE A SAME MODULE FOR ALL
  //imports.push(import('@zanix/server'))

  await Promise.all(imports)
}
