import ts from 'typescript'
import {
  Project,
  BooleanLiteral,
  OptionalKind,
  PropertySignatureStructure,
  StructureKind,
  SourceFile,
  InterfaceDeclaration
} from 'ts-morph'
import { FileEmitter, FileEmitterOptionsArgs } from '@gatewayapps/cradle-file-emitter'
import {
  CradleModel,
  IConsole,
  PropertyType,
  PropertyTypes,
  ArrayPropertyType,
  ImportModelType,
  ReferenceModelType,
  CradleSchema,
  StringPropertyType
} from '@gatewayapps/cradle'
import { parse } from 'path'

export class TypeScriptEmitter extends FileEmitter {
  private tsProject: Project

  constructor(options: FileEmitterOptionsArgs, output: string, _console: IConsole) {
    super(options, output, _console)
    this.tsProject = new Project({ useVirtualFileSystem: true })
    if (options.formatting === 'prettier') {
      const prettierConfig = options.prettierConfig || {}
      prettierConfig.parser = 'typescript'
      options.prettierConfig = prettierConfig
    }
    this.options = options
  }

  async emitSchema(schema: CradleSchema) {
    if (this.outputType === 'oneFilePerModel') {
      schema.Models.forEach((model) => {
        const modelPath = this.getFilePathForModel(model)
        const parsed = parse(modelPath)
        const sourceFile = this.tsProject.createSourceFile(parsed.base)
        sourceFile.addInterface({ name: `I${model.Name}`, isExported: true })
      })
    }

    return super.emitSchema(schema)
  }

  async getContentsForModel(model: CradleModel): Promise<string> {
    const modelPath = this.getFilePathForModel(model)
    const parsed = parse(modelPath)

    let sourceFile: SourceFile
    let iFace: InterfaceDeclaration
    if (this.outputType === 'oneFilePerModel') {
      sourceFile = this.tsProject.getSourceFileOrThrow(parsed.base)
      iFace = sourceFile.getInterfaceOrThrow(`I${model.Name}`)
    } else {
      sourceFile = this.tsProject.createSourceFile(`${model.Name}.ts`)
      iFace = sourceFile.addInterface({ name: `I${model.Name}` })
    }

    const propNames = Object.keys(model.Properties)
    const properties: OptionalKind<PropertySignatureStructure>[] = []
    propNames.forEach((propName) => {
      const prop: PropertyType = model.Properties[propName]
      let leadingTrivia: string = ''

      properties.push({
        name: propName,
        leadingTrivia,
        type: this.wrapMapType(model.Properties[propName])
      })
    })

    iFace.addProperties(properties)

    if (this.outputType === 'oneFilePerModel') {
      sourceFile.fixMissingImports()
    }

    return sourceFile.print()
  }
  async mergeFileContents(modelFileContents: any[]): Promise<string> {
    return modelFileContents.map((fc) => fc.contents).join('\n\n')
  }

  private wrapMapType(propertyType: PropertyType) {
    const actualType = this.mapType(propertyType)
    if (propertyType.AllowNull) {
      return `${actualType} | null`
    } else {
      return actualType
    }
  }

  private mapType(propertyType: PropertyType): string {
    switch (propertyType.TypeName) {
      case PropertyTypes.Boolean: {
        return 'boolean'
      }
      case PropertyTypes.Binary: {
        return 'ArrayBuffer'
      }
      case PropertyTypes.DateTime: {
        return 'Date'
      }
      case PropertyTypes.Decimal:
      case PropertyTypes.Integer: {
        return 'number'
      }
      case PropertyTypes.UniqueIdentifier:
      case PropertyTypes.String: {
        const stringProperty = propertyType as StringPropertyType
        if (stringProperty.AllowedValues && stringProperty.AllowedValues.length > 0) {
          return stringProperty.AllowedValues.map((v) => `'${v}'`).join(' | ')
        }

        return 'string'
      }
      case PropertyTypes.Array: {
        const arrayType = propertyType as ArrayPropertyType
        if (typeof arrayType.MemberType === 'string') {
          return `${arrayType.MemberType}[]`
        } else {
          const baseType = this.mapType(arrayType.MemberType)
          return `${baseType}[]`
        }
      }
      case PropertyTypes.ImportModel: {
        const importType = propertyType as ImportModelType
        return `I${importType.ModelName}`
      }
      case PropertyTypes.ReferenceModel: {
        const referenceType = propertyType as ReferenceModelType
        return `I${referenceType.ModelName}`
      }
      case PropertyTypes.Object: {
        return 'object'
      }
      default: {
        return 'any'
      }
    }
  }
}
