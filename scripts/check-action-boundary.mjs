import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Mixed files retain read/presentation dependencies. Only these mutation bodies
// (and their same-file helpers) are checked for calls to owned domain workflows.
export const mutationMethods = {
  'apps/web/app/mcp/confirm/[confirmationId]/actions.ts': [
    'approveMcpConfirmation',
    'cancelMcpConfirmation',
  ],
  'src/controllers/McpCommandHandler.ts': ['handleSlashCommand', 'handleButtonInteraction'],
  'apps/web/lib/mcp/server.ts': ['createMcpHandler'],
  'apps/web/lib/mcp/tools/bindings.ts': ['createWorkflowTools'],
  'apps/web/lib/mcp/tools/approvals.ts': ['createApprovalTools'],
  'apps/web/lib/mcp/endpoint.ts': ['handleMcpRequest'],
  'src/controllers/InteractionHandler.ts': [
    'handleQueueAcknowledgeButtonInteraction',
    'executeCaptchaAction',
    'executeConfirmedAdminAction',
    'executeDetectionAction',
    'executeConfirmedCaseAction',
    'handleRepairActiveCaseButton',
    'handleSyncAlreadyBannedButton',
    'handleCloseNoActionButton',
    'handleVerifyButton',
    'handleThreadButton',
    'handleReopenButton',
    'handleModerationActionConfirmationModalSubmit',
    'handleOpenCaseContextModalSubmit',
    'handleVerificationBanModalSubmit',
    'handleAccountQuarantineModalSubmit',
    'handleVerificationKickModalSubmit',
    'handleObservedButtonInteraction',
    'handleObservedKickModalSubmit',
    'handleObservedBanModalSubmit',
  ],
  'src/controllers/CaseCommandHandler.ts': [
    'handleCaseUserCommand',
    'handleCaseRepairCommand',
    'handleCaseRefreshCommand',
    'executeRoleIntake',
  ],
  'src/controllers/ModerationCommandHandler.ts': [
    'handleReviewReportBanCommand',
    'handleBanCommand',
    'handleAuditCommand',
    'handleFlagUserCommand',
    'handleIntegrityAuditCommand',
    'handleCloseResolvedThreadsCommand',
  ],
  'src/controllers/CommandHandler.ts': ['handleConfigCommand'],
  'src/controllers/ConfigSubcommandHandler.ts': [
    'executeSetup',
    'executeQueueOperation',
    'handleRoleGateConfigCommand',
    'handleRoleQuarantineConfigCommand',
    'handleCaseQueueConfigCommand',
    'handleManualIntakeConfigCommand',
    'handleDetectionConfigCommand',
    'handleCaseStaffConfigCommand',
    'handleCaseReviewConfigCommand',
    'handleReportConfigCommand',
    'handleAnalyticsConfigCommand',
    'handleVerificationConfigCommand',
    'handleHeuristicConfigCommand',
  ],
  'src/controllers/LockdownConfigCommandHandler.ts': [
    'handleLockdownConfigCommand',
    'handleLockdownAllowListCommand',
  ],
  'src/controllers/ReportCommandHandler.ts': ['submitReport', 'handleSetupReportButtonCommand'],
  'src/controllers/ReportInteractionHandler.ts': [
    'handleReportUserInitiate',
    'handleReportIntakeConfirm',
    'handleReportIntakeReject',
    'handleReportMessageModalSubmit',
    'handleReportUserModalSubmit',
    'closeReportIntake',
    'executeReport',
  ],
  'src/controllers/SetupCommandHandler.ts': [
    'handleSetupVerificationCommand',
    'handleConfigSetupCommand',
  ],
  'src/controllers/SetupVerificationModalHandler.ts': ['handleSetupVerificationModalSubmit'],
  'apps/web/lib/activeCaseDataAdapter.ts': ['queueCaseAction'],
  'apps/web/lib/application/queuedSubmission.ts': [
    'submitQueuedAction',
    'submitSerializedSetupAction',
  ],
  'apps/web/lib/reportQueueDataAdapter.ts': ['closeSubmittedReport', 'openCaseFromSubmittedReport'],
  'apps/web/lib/queueAttentionActionAdapter.ts': [
    'acknowledgeAttentionItem',
    'acknowledgeAttentionItems',
  ],
  'apps/web/lib/captchaCompletion.ts': [
    'beginCaptchaAttempt',
    'recordCaptchaIdentityMismatch',
    'completeCaptchaAttempt',
    'requeueCaptchaPassEffect',
  ],
};
const workflowOwners =
  /\/(?:UserModerationService|SecurityActionService|ReportSubmissionService|ReportIntakeService|ReportReviewService|ReportInstructionsManager|RoleGateService|AccountQuarantineService|CaptchaChallengeService|CaseMessageCleanupService|MessageCleanupService|CaseThreadClosureSweepService|CaseRoleLockdownService|IntegrityAuditService|SetupWorkflowService|SetupProvisioningService|ConfigService|ModerationQueueService)\.ts$|\/src\/repositories\/[^/]+\.ts$/;
const readMethods = /^(?:get|find|list|count|build|format|is|has|can|parse|load)/;
const presentationMethods = new Set(['sendReportConfirmation', 'sendReportInstructions']);
const normalize = (value) => value.split(path.sep).join('/');
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function source(root, file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}
function registryKeys(root, file, name) {
  const keys = new Set();
  let found = false;
  walk(source(root, file), (node) => {
    if (!ts.isVariableDeclaration(node) || node.name.getText() !== name) return;
    let value = node.initializer;
    while (
      value &&
      (ts.isSatisfiesExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isParenthesizedExpression(value))
    )
      value = value.expression;
    if (!value || !ts.isObjectLiteralExpression(value))
      throw new Error(`${name} must be an explicit object registry`);
    found = true;
    for (const property of value.properties) {
      if (!property.name || ts.isComputedPropertyName(property.name))
        throw new Error(`${name} has an uncheckable registry entry`);
      keys.add(property.name.text);
    }
  });
  if (!found) throw new Error(`Missing ${name}`);
  return keys;
}
function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ['node_modules', 'dist', '.next', 'coverage', 'generated', '__tests__'].includes(entry.name)
    )
      return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? filesBelow(file)
      : /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}
function isActionUi(file) {
  return (
    /^apps\/web\/app\/.*(?:[Aa]ctions|actions)\.tsx?$/.test(file) ||
    /^apps\/web\/components\//.test(file) ||
    /^apps\/web\/(?:lib\/mcp\/(?:server|tools\/[^/]+)\.ts|app\/api\/mcp\/route\.ts)$/.test(file)
  );
}
function inspectDependencies(root, errors) {
  const names = [
    'src/controllers',
    'apps/web/app',
    'apps/web/components',
    'apps/web/lib',
    'packages/application/src',
  ].flatMap((dir) => filesBelow(path.join(root, dir)));
  const program = ts.createProgram(names, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    jsx: ts.JsxEmit.Preserve,
    esModuleInterop: true,
    skipLibCheck: true,
    types: [],
    baseUrl: path.join(root, 'apps/web'),
    paths: { '@/*': ['./*'] },
  });
  const checker = program.getTypeChecker();
  function resolvedSymbol(node) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol;
  }
  function declarations(node) {
    return resolvedSymbol(node)?.declarations ?? [];
  }
  function ownsWorkflow(symbol, visited = new Set()) {
    if (!symbol || visited.has(symbol)) return false;
    visited.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Alias)
      return ownsWorkflow(checker.getAliasedSymbol(symbol), visited);
    if (!(symbol.flags & ts.SymbolFlags.Value)) return false;
    if (
      symbol.declarations?.some((declaration) =>
        workflowOwners.test(normalize(declaration.getSourceFile().fileName))
      )
    )
      return true;
    if (symbol.flags & ts.SymbolFlags.Module)
      return checker.getExportsOfModule(symbol).some((exported) => ownsWorkflow(exported, visited));
    return false;
  }
  const report = (file, node, message) =>
    errors.push(
      `${file}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`
    );
  for (const file of program.getSourceFiles()) {
    const relative = normalize(path.relative(root, file.fileName));
    if (relative.startsWith('..') || file.isDeclarationFile || relative.includes('node_modules/'))
      continue;
    if (isActionUi(relative)) {
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (statement.isTypeOnly || statement.importClause?.isTypeOnly) continue;
        const specifier = statement.moduleSpecifier?.text ?? '';
        const direct =
          /(?:^|\/)(?:services|workflows)\//.test(specifier) ||
          /(?:[Ww]orkflow|[Rr]eportReviewService)$/.test(specifier);
        let owned = direct;
        walk(statement, (node) => {
          if (ts.isIdentifier(node) && ownsWorkflow(resolvedSymbol(node))) owned = true;
        });
        if (owned) report(relative, statement, 'forbidden direct workflow import in action UI');
      }
    }
    const methods = mutationMethods[relative];
    if (!methods) continue;
    const visited = new Set();
    function inspect(body) {
      if (visited.has(body)) return;
      visited.add(body);
      walk(body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const target = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name
          : node.expression;
        const signature = checker.getResolvedSignature(node)?.declaration;
        const origins = new Set([...declarations(target), ...(signature ? [signature] : [])]);
        for (const declaration of origins) {
          const owner = normalize(declaration.getSourceFile().fileName);
          const name = declaration.name?.getText() ?? target.getText();
          // Persisting a typed command is a transport boundary, not enforcement.
          const enqueue =
            owner.endsWith('/ModerationActionRequestRepository.ts') && name === 'enqueue';
          const preview =
            (owner.endsWith('/RoleGateService.ts') && name === 'previewResolution') ||
            (owner.endsWith('/ReportInstructionsManager.ts') && name === 'readRepostBinding');
          if (
            !enqueue &&
            !preview &&
            workflowOwners.test(owner) &&
            !readMethods.test(name) &&
            !presentationMethods.has(name)
          )
            report(relative, node, `forbidden direct workflow call ${name}`);
          if (declaration.getSourceFile() === file && declaration.body) inspect(declaration.body);
          if (
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            declaration.getSourceFile() === file
          )
            inspect(declaration.initializer);
        }
      });
    }
    const found = new Set();
    walk(file, (node) => {
      if (node.body && node.name && methods.includes(node.name.getText())) {
        found.add(node.name.getText());
        inspect(node.body);
      }
    });
    if (fs.existsSync(path.join(root, 'package.json'))) {
      for (const method of methods)
        if (!found.has(method))
          errors.push(`${relative}: inventoried mutation ${method} is missing`);
    }
  }
  // Follow core's runtime import/export graph, including aliases/re-exports.
  const visited = new Set();
  function core(fileName) {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    const file = program.getSourceFile(fileName);
    if (!file) return;
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (statement.isTypeOnly || statement.importClause?.isTypeOnly || !statement.moduleSpecifier)
        continue;
      const specifier = statement.moduleSpecifier.text;
      if (
        /^(?:next(?:\/|$)|discord\.js$|@prisma\/|pg$)|(?:postgres|\/di\/|credentials)/.test(
          specifier
        )
      )
        report(
          normalize(path.relative(root, fileName)),
          statement,
          `core imports runtime dependency ${specifier}`
        );
      const resolved = ts.resolveModuleName(
        specifier,
        fileName,
        program.getCompilerOptions(),
        ts.sys
      ).resolvedModule;
      if (
        resolved &&
        normalize(resolved.resolvedFileName).startsWith(
          normalize(path.join(root, 'packages/application/src'))
        )
      )
        core(resolved.resolvedFileName);
    }
  }
  core(path.join(root, 'packages/application/src/index.ts'));
}
export function checkActionBoundary(root) {
  const errors = [];
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const body = schema.match(/enum moderation_action_request_type\s*\{([^}]+)\}/)?.[1];
  if (!body) throw new Error('Missing moderation_action_request_type enum');
  const kinds = body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
  const codecs = registryKeys(
    root,
    'packages/application/src/requests/commands.ts',
    'queuedCommandSchemas'
  );
  const handlers = registryKeys(root, 'src/application/requestDispatch.ts', 'queuedActionHandlers');
  for (const kind of kinds) {
    if (!codecs.has(kind)) errors.push(`${kind}: missing codec`);
    if (!handlers.has(kind)) errors.push(`${kind}: missing worker handler`);
  }
  for (const kind of new Set([...codecs, ...handlers]))
    if (!kinds.includes(kind)) errors.push(`${kind}: registry kind is absent from schema enum`);
  const inventory = fs.readFileSync(
    path.join(root, 'docs/dev/action-boundary-inventory.md'),
    'utf8'
  );
  for (const line of inventory.split('\n'))
    if (
      line.startsWith('|') &&
      line
        .split('|')
        .some((cell) => /^(?:pending|unmigrated|not migrated|TODO)$/i.test(cell.trim()))
    )
      errors.push('Caller checklist contains an unmigrated row');
  for (const kind of kinds)
    if (!inventory.includes('`' + kind + '`')) errors.push(`${kind}: missing caller checklist row`);
  const settingsPath = 'packages/application/src/setup/settings.ts';
  if (fs.existsSync(path.join(root, settingsPath))) {
    walk(source(root, settingsPath), (node) => {
      if (!ts.isVariableDeclaration(node) || node.name.getText() !== 'guildSetupUpdateSchema')
        return;
      walk(node.initializer, (child) => {
        if (!ts.isCallExpression(child) || child.expression.getText() !== 'z.object') return;
        const shape = child.arguments[0];
        if (!shape || !ts.isObjectLiteralExpression(shape))
          throw new Error('Setup fields must have an explicit schema');
        for (const field of shape.properties) {
          const key = field.name?.getText();
          if (
            key &&
            !['guildId', 'updatedBy'].includes(key) &&
            !inventory.includes('`' + key + '`')
          )
            errors.push(`${key}: missing mutable setup field coverage`);
        }
      });
    });
  }
  inspectDependencies(root, errors);
  return { errors, kinds: kinds.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkActionBoundary(path.resolve(process.argv[2] ?? '.'));
    if (result.errors.length) {
      console.error(result.errors.join('\n'));
      process.exitCode = 1;
    } else
      console.log(
        `Action boundary: ${result.kinds} enum kinds have codecs, handlers and caller coverage; dependency checks passed.`
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
