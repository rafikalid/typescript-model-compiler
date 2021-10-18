switch (node.kind) {
	case ts.SyntaxKind.InterfaceDeclaration:
	case ts.SyntaxKind.ClassDeclaration: {
		if (_hasNtExport(node, srcFile)) continue rootLoop; //* Check for export keyword
		//* Get entity name
		let entity = node as ts.ClassDeclaration;
		let realNodeName = entity.name?.getText();
		entityName ??= realNodeName;
		if (entityName == null)
			throw `Missing entity name at: ${errorFile(srcFile, node)}`;
		//* Check if this class resolves methods from an other entity
		let targetEntities: string[] = [];
		let inherited: Reference[] | undefined;
		if (entity.heritageClauses == null) {
			isInput = undefined;
		} else {
			let isInterface = ts.isInterfaceDeclaration(node);
			for (let i = 0, clauses = entity.heritageClauses, len = clauses.length; i < len; ++i) {
				for (let j = 0, types = clauses[i].types, jLen = types.length; j < jLen; ++j) {
					let type = types[j];
					// Check for "ResolverOutputConfig" && "ResolverInputConfig"
					let typeSymbol = typeChecker.getSymbolAtLocation(type.expression);
					if (typeSymbol == null || typeSymbol.name == null)
						throw `Could not resolve type "${type.expression.getText()}" at ${errorFile(srcFile, type)}`;
					switch (typeSymbol.name) {
						case 'ResolverInputConfig':
						case 'ResolverOutputConfig':
							{
								if (isInterface)
									throw `An interface could not extends "${typeSymbol.name}". at ${errorFile(srcFile, type)}`;
								let isResolverOutputConfig = typeSymbol.name === 'ResolverOutputConfig';
								if (isInput === isResolverOutputConfig)
									throw `Could not implement "${typeSymbol.name}" for ${isResolverOutputConfig ? 'output' : 'input'} only entities. at ${errorFile(srcFile, type)}`;
								let t = type.typeArguments![0];
								if (!ts.isTypeReferenceNode(t) || !typeChecker.getTypeFromTypeNode(t).isClassOrInterface())
									throw `Expected "ResolverInputConfig" argument to reference a "class" or "interface" at ${errorFile(srcFile, t)}`;
								let typeName = typeChecker.getSymbolAtLocation(t.typeName)!.name;
								targetEntities.push(typeName);
								isInput = !isResolverOutputConfig;
								// Add to JsDoc
								jsDoc.push(
									isResolverOutputConfig ? `@ResolversAt ${realNodeName}` : `@InputResolversAt ${realNodeName}`
								);
							}
							break;
						default:
							{
								let nRef: Reference = {
									kind: Kind.REF,
									fileName: fileName,
									name: typeSymbol.name,
									oName: typeSymbol.name,
									fullName: undefined,
									params:
										type.typeArguments == null
											? undefined
											: [],
									visibleFields: undefined
								};
								visitor.push(type.typeArguments, nRef, srcFile);
								(inherited ??= []).push(nRef);
								//TODO resolve real nodes names
								jsDoc.push(`@Extends ${type.getText()}`);
							}
					}
				}
			}
		}
		if (targetEntities.length === 0) targetEntities.push(entityName);
		//* Get Properties
		// console.log('------------', typeChecker.typeToString(nodeType))
		// nodeType.getProperties().forEach(s => {
		// 	let d = s.valueDeclaration as ts.PropertySignature;
		// 	let typeNode = _clearPromise(d.type!);
		// 	let tp = typeChecker.getTypeFromTypeNode(typeNode);
		// 	console.log('===', s.name, ':', d.type?.getText(), "=>", typeChecker.typeToString(tp, typeNode));
		// 	tp.getProperties().forEach(s2 => {
		// 		console.log('----------->', s2.name);
		// 	});
		// });


		//* Visible fields
		let visibleFields = _getRefVisibleFields(typeChecker.getTypeAtLocation(node));
		//* Add entity
		for (let i = 0, len = targetEntities.length; i < len; ++i) {
			let entityName = targetEntities[i];
			let entityDesc = ROOT.get(entityName);
			if (entityDesc == null) {
				// Add Generic params
				let generics: string[] | undefined;
				let tpParams = entity.typeParameters;
				if (tpParams != null) {
					generics = [];
					for (let i = 0, len = tpParams.length; i < len; ++i) {
						generics.push(tpParams[i].name.getText());
					}
				}
				// Entity
				let entityD: PlainObject = {
					kind: Kind.PLAIN_OBJECT,
					name: entityName,
					escapedName: entityName,
					fileNames: [fileName],
					inherit: inherited,
					generics: generics,
					input: {
						before: undefined,
						after: undefined,
						ownedFields: 0,
						fields: new Map(),
						visibleFields: visibleFields,
						jsDoc: jsDoc,
						deprecated: deprecated
					},
					output: {
						before: undefined,
						after: undefined,
						ownedFields: 0,
						fields: new Map(),
						visibleFields: new Map(visibleFields),
						jsDoc: jsDoc.slice(0),
						deprecated: deprecated
					}
				}
				entityDesc = entityD;
				ROOT.set(entityName, entityDesc);
			} else if (entityDesc.kind === Kind.SCALAR) {
				// Do nothing, just keep entity as scalar
				break;
			} else if (entityDesc.kind !== Kind.PLAIN_OBJECT) {
				throw new Error(
					`Entity "${entityName}" has multiple types:\n\t> PLAIN_OBJECT at : ${fileName}\n\t> ${Kind[entityDesc.kind]} at ${entityDesc.fileNames.join(', ')}`
				);
			} else {
				if (inherited != null)
					(entityDesc.inherit ??= []).push(...inherited);
				entityDesc.fileNames.push(fileName);
				// as input only
				if (isInput !== false) {
					let inputObj = (entityDesc as PlainObject).input;
					inputObj.deprecated ??= deprecated;
					visibleFields.forEach((v, k) => {
						inputObj.visibleFields.set(k, v);
					});
					// JsDoc
					inputObj.jsDoc.push(...jsDoc);
				}
				// as output only
				if (isInput !== true) {
					let outputObj = (entityDesc as PlainObject).output;
					outputObj.deprecated ??= deprecated;
					visibleFields.forEach((v, k) => {
						outputObj.visibleFields.set(k, v);
					});
					// JsDoc
					outputObj.jsDoc.push(...jsDoc);
				}
			}
			// Go through properties
			visitor.push(entity.members, entityDesc, srcFile, isInput);
		}
		break;
	}
	case ts.SyntaxKind.PropertyDeclaration:
	case ts.SyntaxKind.PropertySignature:
	case ts.SyntaxKind.MethodDeclaration: {
		if (pDesc == null) continue; // Unexpected!
		if (
			pDesc.kind !== Kind.PLAIN_OBJECT &&
			pDesc.kind !== Kind.OBJECT_LITERAL
		)
			continue;
		let propertyNode = node as ts.PropertyDeclaration;
		let nodeName = propertyNode.name?.getText();
		let className = propertyNode.parent.name?.getText();
		if (className == null)
			throw `Missing class name for method "${nodeName}" at ${errorFile(srcFile, node)}`;
		// Method descriptor (if method)
		let method: MethodDescriptor | undefined;
		let isMethod = node.kind === ts.SyntaxKind.MethodDeclaration;
		if (isMethod) {
			method = {
				fileName: fileName,
				className: className,
				name: nodeName,
				isStatic: node.modifiers?.some(
					n => n.kind === ts.SyntaxKind.StaticKeyword
				) ?? false,
				isClass: ts.isClassDeclaration(node.parent) && !node.parent.modifiers?.some(
					e => e.kind === ts.SyntaxKind.AbstractKeyword
				)
			};
		}
		// Check first for input and then for output
		for (let j = 0, isSelectInput = false; j < 2; ++j) {
			// Check if select only input or output
			if (isInput === !isSelectInput) continue;
			// Methods are output resolvers by default
			if (isMethod && isSelectInput && isInput == null) continue;
			// Get field
			let fieldParent = isSelectInput ? (pDesc as PlainObject).input : (pDesc as PlainObject).output;
			let fields = fieldParent.fields;
			let field = fields.get(nodeName);
			if (field == null) {
				if (isSelectInput) {
					let p: Omit<InputField, 'type'> & { type: undefined } = {
						name: nodeName,
						kind: Kind.INPUT_FIELD,
						required: _isFieldRequired(propertyNode, typeChecker),
						alias: fieldAlias,
						idx: fieldParent.ownedFields++,
						className: className,
						defaultValue: defaultValue,
						type: undefined,
						asserts: asserts && _compileAsserts(asserts, undefined, srcFile, node),
						deprecated: deprecated,
						jsDoc: jsDoc.slice(0),
						method: method,
						fileNames: [fileName]
					}
					field = p as any as InputField;
				} else {
					let p: Omit<OutputField, 'type'> & { type: undefined } = {
						name: nodeName,
						kind: Kind.OUTPUT_FIELD,
						required: _isFieldRequired(propertyNode, typeChecker),
						alias: fieldAlias,
						idx: fieldParent.ownedFields++,
						className: className,
						defaultValue: defaultValue,
						type: undefined,
						method: method,
						param: undefined,
						deprecated: deprecated,
						jsDoc: jsDoc.slice(0),
						fileNames: [fileName]
					};
					field = p as any as OutputField;
				}
				(fields as Map<string, OutputField>).set(nodeName, field as OutputField);
			} else {
				//* Field alias
				if (field.alias == null) field.alias = fieldAlias;
				else if (field.alias !== fieldAlias)
					throw `Field "${className}.${nodeName}" could not have two aliases. got "${field.alias}" and "${fieldAlias}" at ${errorFile(srcFile, node)}`;
				field.deprecated ??= deprecated;
				field.jsDoc.push(...jsDoc);
				field.fileNames.push(fileName);
				if (method != null) {
					if (field.method != null)
						throw `Field "${pDesc.name}.${nodeName}" already has an ${isSelectInput ? 'input' : 'output'
						} resolver as "${field.method.className}.${field.method.name}" . Got "${className}.${nodeName}" at: ${errorFile(srcFile, node)
						}. Other files:\n\t> ${field.fileNames.join("\n\t> ")}`;
					field.method = method;
				}
				if (isSelectInput) {
					if (asserts != null) {
						(field as InputField).asserts = _compileAsserts(
							asserts,
							(field as InputField).asserts,
							srcFile, node
						);
					}
				}
			}
			// Resolve param for methods
			if (isMethod) {
				let param = (node as ts.MethodDeclaration).parameters?.[1];
				if (param == null) {
					if (isSelectInput)
						throw `Missing the second argument of "${className}.${nodeName}" resolver. At ${errorFile(srcFile, node)}`;
				} else {
					// resolve param as input or output type
					visitor.push(param, field, srcFile, isSelectInput);
				}
			}
			// Resolve type
			let returnType = propertyNode.type;
			if (returnType == null) {
				if (isMethod && !isSelectInput)
					throw `Missing return value of the method "${className}.${nodeName}" at ${errorFile(srcFile, node)}`;
			} else if (!isMethod || !isSelectInput) {
				visitor.push(returnType, field, srcFile, isSelectInput, nodeName);
			}
			// Next
			isSelectInput = true;
		}
		break;
	}
	case ts.SyntaxKind.Parameter: {
		let paramNode = node as ts.ParameterDeclaration;
		if (pDesc == null) continue; // Unexpected!
		let paramName = paramNode.name?.getText();
		switch (pDesc.kind) {
			case Kind.OUTPUT_FIELD:
				let pRef: Param = {
					kind: Kind.PARAM,
					name: paramName,
					deprecated: deprecated,
					jsDoc: jsDoc,
					type: undefined,
					fileNames: [fileName]
				};
				// Parse param type
				visitor.push(paramNode.type, pRef, srcFile, isInput, paramName);
				pDesc.param = pRef;
				break;
			case Kind.INPUT_FIELD:
				// Parse param type
				visitor.push(paramNode.type, pDesc, srcFile, isInput, paramName);
				break;
			default:
				throw `Unexpected param parent. got "${Kind[pDesc.kind]}" at ${errorFile(srcFile, node)}`;
		}
		break;
	}
	case ts.SyntaxKind.EnumDeclaration: {
		if (_hasNtExport(node, srcFile)) continue rootLoop; //* Check for export keyword
		let enumNode = node as ts.EnumDeclaration;
		let nodeName = (node as ts.EnumDeclaration).name?.getText();
		let ref = ROOT.get(nodeName);
		if (ref != null)
			throw `Duplicate entity "${nodeName}" as ENUM at ${errorFile(srcFile, node)}. Other files: \n\t> ${ref.fileNames.join("\n\t> ")}`;
		let enumEntity: Enum = {
			kind: Kind.ENUM,
			name: nodeName,
			deprecated: deprecated,
			jsDoc: jsDoc,
			members: [],
			fileNames: [fileName]
		};
		ROOT.set(nodeName, enumEntity);
		visitor.push(node.getChildren(), enumEntity, srcFile, isInput);
		break;
	}
	case ts.SyntaxKind.EnumMember: {
		//* Enum member
		let nodeName = (node as ts.EnumMember).name?.getText();
		if (pDesc == null || pDesc.kind != Kind.ENUM)
			throw `Unexpected ENUM MEMBER "${nodeName}" at: ${errorFile(srcFile, node)}`;
		let enumMember: EnumMember = {
			kind: Kind.ENUM_MEMBER,
			name: nodeName,
			value: typeChecker.getConstantValue(node as ts.EnumMember)!,
			deprecated: deprecated,
			jsDoc: jsDoc,
			fileNames: [fileName]
		};
		pDesc.members.push(enumMember);
		break;
	}
	case ts.SyntaxKind.TypeReference: {
		if (pDesc == null) continue;
		if (
			pDesc.kind !== Kind.OUTPUT_FIELD &&
			pDesc.kind !== Kind.INPUT_FIELD &&
			pDesc.kind !== Kind.LIST &&
			pDesc.kind !== Kind.REF &&
			pDesc.kind !== Kind.PARAM
		)
			continue;
		let refNode = node as ts.TypeReferenceNode;
		console.log('---refNode---', refNode.getText());
		let refEnt: Reference = {
			kind: Kind.REF,
			fileName: fileName,
			name: _refTargetName(refNode, typeChecker), // referenced node's name
			oName: refNode.typeName.getText(),
			fullName: refNode.getText(),
			params: refNode.typeArguments == null ? undefined : [],
			visibleFields: _getRefVisibleFields(nodeType)
		};
		if (pDesc.kind === Kind.REF) pDesc.params!.push(refEnt);
		else pDesc.type = refEnt;
		// Resolve types
		// visitor.push(refNode.typeArguments, refEnt, srcFile, isInput);

		break;
	}
	case ts.SyntaxKind.StringKeyword:
	case ts.SyntaxKind.BooleanKeyword:
	case ts.SyntaxKind.NumberKeyword:
	case ts.SyntaxKind.SymbolKeyword:
	case ts.SyntaxKind.BigIntKeyword: {
		if (pDesc == null) continue;
		if (
			pDesc.kind !== Kind.OUTPUT_FIELD &&
			pDesc.kind !== Kind.INPUT_FIELD &&
			pDesc.kind !== Kind.LIST &&
			pDesc.kind !== Kind.REF &&
			pDesc.kind !== Kind.PARAM
		)
			continue;
		let nodeName = node.getText();
		let basicScalarRef: Reference = {
			kind: Kind.REF,
			name: nodeName,
			oName: nodeName,
			fullName: undefined,
			fileName: srcFile.fileName,
			params: undefined,
			visibleFields: undefined
		};
		if (pDesc.kind === Kind.REF)
			pDesc.params!.push(basicScalarRef);
		else pDesc.type = basicScalarRef;
		break;
	}
	case ts.SyntaxKind.ArrayType: {
		if (pDesc == null) continue;
		if (
			pDesc.kind !== Kind.OUTPUT_FIELD &&
			pDesc.kind !== Kind.INPUT_FIELD &&
			pDesc.kind !== Kind.LIST &&
			pDesc.kind !== Kind.REF &&
			pDesc.kind !== Kind.PARAM
		)
			continue;
		let arrTpe: Omit<List, 'type'> & { type: undefined } = {
			kind: Kind.LIST,
			required: true,
			deprecated: deprecated,
			jsDoc: jsDoc,
			fileNames: [fileName],
			type: undefined
		};
		let arrType = arrTpe as any as List;
		if (pDesc.kind === Kind.REF) pDesc.params!.push(arrType);
		else pDesc.type = arrType;
		// Visit each children
		visitor.push(
			(node as ts.ArrayTypeNode).elementType, arrType, srcFile, isInput);
		break;
	}
	case ts.SyntaxKind.VariableStatement: {
		let variableNode = node as ts.VariableStatement;
		for (
			let i = 0,
			declarations = variableNode.declarationList.declarations,
			len = declarations.length;
			i < len; ++i
		) {
			let declaration = declarations[i];
			let type = declaration.type;
			let nodeName = declaration.name.getText();
			let s: ts.Symbol | undefined;
			if (
				type &&
				ts.isTypeReferenceNode(type) &&
				type.typeArguments?.length === 1 &&
				(s = typeChecker.getSymbolAtLocation(type.typeName))
			) {
				let typeArg = type.typeArguments[0];
				let fieldName = typeArg.getText();
				switch (s.name) {
					case 'ModelScalar': {
						if (_hasNtExport(node, srcFile)) continue rootLoop; //* Check for export keyword
						//* Scalar
						if (!ts.isTypeReferenceNode(typeArg))
							throw `Unexpected scalar name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
						// JUST OVERRIDE WHEN SCALAR :)
						let scalarEntity: Scalar = {
							kind: Kind.SCALAR,
							name: fieldName,
							deprecated: deprecated,
							jsDoc: jsDoc,
							parser: {
								fileName: fileName,
								className: nodeName,
								isStatic: true,
								name: undefined,
								isClass: false
							},
							fileNames: [fileName]
						};
						ROOT.set(fieldName, scalarEntity);
						break;
					}
					case 'UNION': {
						if (_hasNtExport(node, srcFile)) continue rootLoop; //* Check for export keyword
						//* UNION
						if (!ts.isTypeReferenceNode(typeArg))
							throw `Unexpected UNION name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
						let p = ROOT.get(fieldName)
						if (p != null)
							throw `Already defined entity ${fieldName} at ${errorFile(srcFile, declaration)}. Other files: \n\t> ${p.fileNames.join("\n\t> ")}`;
						let unionNode: Union = {
							kind: Kind.UNION,
							name: fieldName,
							deprecated: deprecated,
							jsDoc: jsDoc,
							types: [],
							parser: {
								fileName: fileName,
								className: nodeName,
								isStatic: true,
								name: undefined,
								isClass: false
							},
							fileNames: [fileName]
						};
						ROOT.set(fieldName, unionNode);
						let unionChildren = unionNode.types;
						// Parse members
						const union = typeChecker
							.getAliasedSymbol(
								typeChecker.getSymbolAtLocation(
									typeArg.typeName
								)!
							)
							?.declarations?.[0]?.getChildren()
							.find(
								e => e.kind === ts.SyntaxKind.UnionType
							);
						if (union == null || !ts.isUnionTypeNode(union))
							throw `Missing union types for: "${typeArg.getText()}" at ${typeArg.getSourceFile().fileName
							}`;
						else {
							let unionTypes = union.types;
							for (
								let k = 0, kLen = unionTypes.length;
								k < kLen;
								++k
							) {
								let unionType = unionTypes[k];
								let dec =
									typeChecker.getTypeAtLocation(
										unionType
									).symbol?.declarations?.[0];
								if (
									dec == null ||
									!(
										ts.isInterfaceDeclaration(
											dec
										) || ts.isClassDeclaration(dec)
									)
								)
									throw new Error(
										`Illegal union type: ${dec?.getText() ??
										typeArg.getText()
										} at ${typeArg.getSourceFile()
											.fileName
										}:${typeArg.getStart()}`
									);
								else {
									let refN = dec.name!.getText();
									let ref: Reference = {
										kind: Kind.REF,
										name: refN,
										oName: refN,
										fullName: undefined,
										fileName: srcFile.fileName,
										// TODO add support for Generic types in union
										params: undefined,
										visibleFields: undefined
									};
									unionChildren.push(ref);
								}
							}
						}
						break;
					}
					case 'ResolverConfig': {
						if (_hasNtExport(node, srcFile)) continue rootLoop; //* Check for export keyword
						//* Input resolver
						if (!ts.isTypeReferenceNode(typeArg))
							throw `Unexpected entity name: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
						let inputEntityName =
							typeChecker.getTypeAtLocation(typeArg.typeName)?.symbol?.name;
						if (inputEntityName == null)
							throw `Could not resolve entity: "${fieldName}" at ${errorFile(srcFile, declaration)}`;
						//* Add
						let entity = ROOT.get(inputEntityName);
						if (entity == null) {
							let entityD: PlainObject = {
								kind: Kind.PLAIN_OBJECT,
								name: inputEntityName,
								escapedName: inputEntityName,
								fileNames: [fileName],
								inherit: undefined,
								generics: undefined,
								input: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: new Map(),
									jsDoc: jsDoc,
									deprecated: deprecated
								},
								output: {
									before: undefined,
									after: undefined,
									ownedFields: 0,
									fields: new Map(),
									visibleFields: new Map(),
									jsDoc: jsDoc.slice(0),
									deprecated: deprecated
								}
							}
							entity = entityD;
						} else if (entity.kind !== Kind.PLAIN_OBJECT)
							throw `Expected Entity "${inputEntityName}" as PLAIN_OBJECT. Got "${Kind[entity.kind]}" at ${errorFile(srcFile, declaration)}`;
						let obj = declaration.initializer;
						if (obj == null)
							throw `Missing Entity configuration for "${inputEntityName}" at ${errorFile(srcFile, declaration)}`;
						if (!ts.isObjectLiteralExpression(obj))
							throw `Expected an object literal expression to define the configuration for entity "${inputEntityName}". Got "${ts.SyntaxKind[obj.kind]}" at ${errorFile(srcFile, obj)}`;
						for (let j = 0, properties = obj.properties, jLen = properties.length; j < jLen; ++j) {
							let property = properties[j];
							if (!ts.isPropertyAssignment(property)) continue;
							switch (property.name?.getText()) {
								case "outputFields":
									visitor.push(property.initializer, entity, srcFile, false, entity.name);
									break;
								case 'inputFields':
									visitor.push(property.initializer, entity, srcFile, true, entity.name);
									break;
								case 'outputBefore':
									if (entity.output.before != null)
										throw `Already defined "${entity.name}::outputBefore" at ${errorFile(srcFile, property)}`;
									entity.output.before = {
										name: 'outputBefore',
										className: nodeName,
										fileName: fileName,
										isClass: false,
										isStatic: true
									}
									break;
								case 'outputAfter':
									if (entity.output.after != null)
										throw `Already defined "${entity.name}::outputAfter" at ${errorFile(srcFile, property)}`;
									entity.output.after = {
										name: 'outputAfter',
										className: nodeName,
										fileName: fileName,
										isClass: false,
										isStatic: true
									}
									break;
								case 'inputBefore':
									if (entity.input.before != null)
										throw `Already defined "${entity.name}::inputBefore" at ${errorFile(srcFile, property)}`;
									entity.input.before = {
										name: 'inputBefore',
										className: nodeName,
										fileName: fileName,
										isClass: false,
										isStatic: true
									}
									break;
								case 'inputAfter':
									if (entity.input.after != null)
										throw `Already defined "${entity.name}::inputAfter" at ${errorFile(srcFile, property)}`;
									entity.input.after = {
										name: 'inputAfter',
										className: nodeName,
										fileName: fileName,
										isClass: false,
										isStatic: true
									}
									break;
							}
						}
						break;
					}
				}
			}
		}
		break;
	}
	case ts.SyntaxKind.TypeLiteral: {
		//* Type literal are equivalent to nameless classes
		if (pDesc == null) continue;
		if (pDesc.kind === Kind.PLAIN_OBJECT) {
			//* Update already defined plain object
			//TODO check works
			visitor.push(node.getChildren(), pDesc, srcFile, isInput);
		} else if (
			pDesc.kind === Kind.OUTPUT_FIELD ||
			pDesc.kind === Kind.INPUT_FIELD ||
			pDesc.kind === Kind.LIST ||
			pDesc.kind === Kind.PARAM
		) {
			entityName ??= '';
			let nodeType = typeChecker.getTypeAtLocation(node);
			// Define nameless class
			let typeLiteral: ObjectLiteral = {
				kind: Kind.OBJECT_LITERAL,
				name: entityName,
				escapedName: entityName,
				fileNames: [fileName],
				generics: undefined,
				inherit: undefined,
				input: {
					after: undefined,
					before: undefined,
					deprecated: deprecated,
					fields: new Map(),
					jsDoc: jsDoc,
					ownedFields: 0,
					visibleFields: _getRefVisibleFields(nodeType)
				},
				output: {
					after: undefined,
					before: undefined,
					deprecated: deprecated,
					fields: new Map(),
					jsDoc: jsDoc,
					ownedFields: 0,
					visibleFields: _getRefVisibleFields(nodeType)
				}
			};
			let typeRef: Reference = {
				kind: Kind.REF,
				name: entityName,
				oName: entityName,
				fileName: srcFile.fileName,
				params: undefined,
				fullName: undefined,
				visibleFields: _getRefVisibleFields(nodeType)
			};
			namelessEntities.push({
				name: entityName,
				node: typeLiteral,
				ref: typeRef,
			});
			pDesc.type = typeRef;
			// Go through fields
			visitor.push(node.getChildren(), typeLiteral, srcFile, isInput);
		}
		break;
	}
	case ts.SyntaxKind.UnionType: {
		if (pDesc == null) continue;
		if (
			pDesc.kind !== Kind.OUTPUT_FIELD &&
			pDesc.kind !== Kind.INPUT_FIELD &&
			pDesc.kind !== Kind.LIST &&
			pDesc.kind !== Kind.PARAM
		)
			continue;
		let unionNode = node as ts.UnionTypeNode;
		let nonNullTypes: ts.TypeNode[] = []
		for (let i = 0, types = unionNode.types, len = types.length; i < len; ++i) {
			let type = types[i];
			if (
				type.kind === ts.SyntaxKind.UndefinedKeyword ||
				type.kind === ts.SyntaxKind.NullKeyword ||
				(type.kind === ts.SyntaxKind.LiteralType &&
					type.getText() === 'null')
			) {
				(pDesc as InputField | OutputField).required = false;
			} else {
				nonNullTypes.push(type);
			}
		}
		if (nonNullTypes.length > 1) {
			//* Defined union
			// TODO support native unions
			throw `Please give a name to the union "${nonNullTypes.map(e => e.getText()).join(' | ')}" at ${errorFile(srcFile, node)}`;
		} else if (nonNullTypes.length === 1) {
			//* Simple reference
			visitor.push(nonNullTypes[0], pDesc, srcFile, isInput);
		}
		break;
	}
	case ts.SyntaxKind.TypeOperator:
		//FIXME Check what TypeOperatorNode do!
		visitor.push(
			(node as ts.TypeOperatorNode).type, pDesc, srcFile, isInput);
		break;
	case ts.SyntaxKind.SyntaxList:
		visitor.push(node.getChildren(), pDesc, srcFile, isInput);
		break;
	case ts.SyntaxKind.TupleType:
		throw `Tuples are unsupported. Did you mean Array of types? at ${errorFile(srcFile, node)}`;
}