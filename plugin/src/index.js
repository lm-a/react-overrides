import { declare } from "@babel/helper-plugin-utils";
import { generateSafetyMemberExpression } from "./memberExpressionGenerator";
import { findHighestParent, findParent } from "./findParent";
const t = require("@babel/types");
import syntaxJSX from "@babel/plugin-syntax-jsx";

const OVERRIDABLE_PROPS_VAR = "overridableProps";
const OVERRIDABLE_COMPONENTS_VAR = "overridableComponents";

const generateOverridablePropsVariableDeclaration = () => {
    const variableDeclaration = t.variableDeclaration("const", [
        t.variableDeclarator(
            t.identifier(OVERRIDABLE_PROPS_VAR),
            t.conditionalExpression(
                t.binaryExpression(
                    "!==",
                    t.unaryExpression("typeof", t.identifier("props"), true),
                    t.stringLiteral("undefined")
                ),
                t.identifier("props"),
                t.conditionalExpression(
                    t.logicalExpression(
                        "&&",
                        t.thisExpression(),
                        t.binaryExpression(
                            "!==",
                            t.unaryExpression(
                                "typeof",
                                t.memberExpression(t.thisExpression(), t.identifier("props")),
                                true
                            ),
                            t.stringLiteral("undefined")
                        )
                    ),
                    t.memberExpression(t.thisExpression(), t.identifier("props")),
                    t.memberExpression(t.identifier("arguments"), t.numericLiteral(0), true)
                )
            )
        )
    ]);
    variableDeclaration.isOverridablePropsVariableDeclaration = true;
    return variableDeclaration;
};

const updateOverridablePropsAndComponents = (path, componentName) => {
    const functionExpression = findHighestParent(
        path,
        path =>
            t.isArrowFunctionExpression(path) ||
            t.isFunctionExpression(path) ||
            t.isClassMethod(path) ||
            t.isFunctionDeclaration(path)
    );
    if (!functionExpression) {
        return;
    }
    if (!t.isBlockStatement(functionExpression.node.body)) {
        functionExpression.node.body = t.blockStatement([t.returnStatement(functionExpression.node.body)]);
    }
    const blockStatement = functionExpression.node.body;
    const overridablePropsVariableDeclaration = blockStatement.body.find(
        expression => expression.isOverridablePropsVariableDeclaration
    );
    if (!overridablePropsVariableDeclaration) {
        blockStatement.body.splice(blockStatement.body.length - 1, 0, generateOverridablePropsVariableDeclaration());
    }
    let overridableComponentsVariableDeclaration = blockStatement.body.find(
        expression => expression.isOverridableComponentsVariableDeclaration
    );
    if (!overridableComponentsVariableDeclaration) {
        overridableComponentsVariableDeclaration = t.variableDeclaration("const", [
            t.variableDeclarator(t.identifier(OVERRIDABLE_COMPONENTS_VAR), t.objectExpression([]))
        ]);
        overridableComponentsVariableDeclaration.isOverridableComponentsVariableDeclaration = true;
        blockStatement.body.splice(blockStatement.body.length - 1, 0, overridableComponentsVariableDeclaration);
    }
    const classProperties = overridableComponentsVariableDeclaration.declarations[0].init.properties;
    const overridedClass = overridableComponentsVariableDeclaration.declarations[0].init.properties.find(
        property => property.key.name === componentName
    );
    if (!overridedClass) {
        classProperties.push(
            t.objectProperty(
                t.identifier(componentName),
                generateSafetyMemberExpression(
                    [OVERRIDABLE_PROPS_VAR, "overrides", componentName, "component"],
                    t.identifier(componentName)
                )
            )
        );
    }
};

export default declare((api, options, dirname) => {
    api.assertVersion(7);
    let reactOverridesImportName = null;

    const identifierVisitor = path => {
        if (!reactOverridesImportName || path.node.name !== reactOverridesImportName) {
            return;
        }

        const jsxElement = findParent(path, path => t.isJSXElement(path));
        if (!jsxElement) {
            return;
        }
        const openingElement = jsxElement.node.openingElement;
        const ComponentName = t.isJSXMemberExpression(openingElement.name)
            ? openingElement.name.property.name
            : openingElement.name.name;

        const propsMemberExpression = generateSafetyMemberExpression([
            OVERRIDABLE_PROPS_VAR,
            "overrides",
            ComponentName,
            "props"
        ]);
        path.replaceWith(propsMemberExpression);

        updateOverridablePropsAndComponents(path, ComponentName);

        const ComponentNameReplacement = t.jsxMemberExpression(
            t.jsxIdentifier(OVERRIDABLE_COMPONENTS_VAR),
            t.jsxIdentifier(ComponentName)
        );
        openingElement.name = ComponentNameReplacement;
        if (jsxElement.node.closingElement) {
            jsxElement.node.closingElement.name = ComponentNameReplacement;
        }

        if (t.isCallExpression(path.parentPath)) {
            path.parentPath.replaceWith(propsMemberExpression);
        }
    };

    return {
        name: "babel-plugin-react-overrides",
        inherits: syntaxJSX,

        visitor: {
            Program(programPath) {
                programPath.traverse({
                    ImportDeclaration: path => {
                        if (path.node.source.value !== "react-overrides") {
                            return;
                        }
                        const defaultSpecifier = path.node.specifiers.find(specifier =>
                            t.isImportDefaultSpecifier(specifier)
                        );
                        if (!defaultSpecifier) {
                            return;
                        }
                        reactOverridesImportName = defaultSpecifier.local.name;
                        const isHaveNotDefaultSpecifier = path.node.specifiers.find(
                            specifier => !t.isImportDefaultSpecifier(specifier)
                        );
                        if (!isHaveNotDefaultSpecifier) {
                            path.remove();
                        } else {
                            path.node.specifiers = path.node.specifiers.filter(
                                specifier => !t.isImportDefaultSpecifier(specifier)
                            );
                        }
                    },
                    ClassDeclaration(classPath) {
                        classPath.traverse({
                            Identifier: identifierVisitor
                        });
                    },
                    Identifier: identifierVisitor
                });
            }
        }
    };
});
