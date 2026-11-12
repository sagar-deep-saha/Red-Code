/* Temporary end-to-end verification against a real git repository. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDeploymentSet, DEFAULT_EXCLUDES, mergeChanges, parseNameStatus } from '../out/deploySet.js';
import { commitNameStatus, diffNameStatus, readBlob, resolveCommit, treePaths } from '../out/git.js';

const root = mkdtempSync(path.join(tmpdir(), 'redcode-deploy-'));
const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });

function write(relative, content) {
	const file = path.join(root, relative);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content, 'utf8');
}

git('init', '-q', '-b', 'main');
write('app/A.php', 'one\n');
write('app/Keep.php', 'keep1\n');
write('app/Sp ace.php', 'space1\n');
write('vendor/x.php', 'v1\n');
write('.env', 'SECRET=1\n');
git('add', '-A');
git('commit', '-q', '-m', 'c1');
const c1 = git('rev-parse', 'HEAD').trim();

git('mv', 'app/A.php', 'app/B.php');
write('app/Keep.php', 'keep2\n');
write('app/Sp ace.php', 'space2\n');
write('vendor/x.php', 'v2\n');
git('add', '-A');
git('commit', '-q', '-m', 'c2');
const c2 = git('rev-parse', 'HEAD').trim();

write('app/Temp.php', 'temp\n');
git('add', '-A');
git('commit', '-q', '-m', 'c3');
const c3 = git('rev-parse', 'HEAD').trim();

git('rm', '-q', 'app/Temp.php');
write('app/New.php', 'new\n');
git('add', '-A');
git('commit', '-q', '-m', 'c4');
const c4 = git('rev-parse', 'HEAD').trim();

const report = (label, set) => {
	console.log(`\n${label}`);
	console.log('  files   :', set.files.map(file => `${file.status[0].toUpperCase()} ${file.path}${file.previousPath ? ` <- ${file.previousPath}` : ''}`).join(', '));
	console.log('  delete  :', set.deletions.map(file => file.path).join(', '));
	console.log('  excluded:', set.excluded.join(', '));
};

const range = async (from, to) => {
	const changes = parseNameStatus(await diffNameStatus(root, from, to));
	const [sourceTree, targetTree] = await Promise.all([treePaths(root, from), treePaths(root, to)]);
	return buildDeploymentSet(changes, DEFAULT_EXCLUDES, sourceTree, targetTree);
};

const selected = async (commits) => {
	const groups = [];
	for (const sha of commits) {
		groups.push(parseNameStatus(await commitNameStatus(root, sha)));
	}
	const targetTree = await treePaths(root, commits[commits.length - 1]);
	const parent = await resolveCommit(root, `${commits[0]}^`);
	const sourceTree = parent ? await treePaths(root, parent) : undefined;
	return buildDeploymentSet(mergeChanges(...groups), DEFAULT_EXCLUDES, sourceTree, targetTree);
};

const problems = [];
const expect = (label, actual, expected) => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		problems.push(`${label}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
	}
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
};

const set = await range(c1, c4);
report('range c1..c4', set);
console.log('\nrange c1..c4 expectations');
expect('uploads', set.files.map(file => file.path), ['app/B.php', 'app/Keep.php', 'app/New.php', 'app/Sp ace.php']);
expect('deletions', set.deletions.map(file => file.path), ['app/A.php']);
expect('excluded', set.excluded, ['vendor/x.php']);
expect('rename source', set.files.find(file => file.path === 'app/B.php')?.previousPath, 'app/A.php');

console.log('\nselected commits c2,c3 expectations');
const multi = await selected([c2, c3]);
report('selected c2,c3', multi);
expect('uploads', multi.files.map(file => file.path), ['app/B.php', 'app/Keep.php', 'app/Sp ace.php', 'app/Temp.php']);
expect('deletions', multi.deletions.map(file => file.path), ['app/A.php']);
expect('excluded', multi.excluded, ['vendor/x.php']);

console.log('\nblob and tree expectations');
const blob = await readBlob(root, c4, 'app/B.php');
expect('blob content from c4', blob.toString('utf8'), 'one\n');
const c4tree = await treePaths(root, c4);
expect('c4 has New.php', c4tree.has('app/New.php'), true);
expect('c4 has no A.php', c4tree.has('app/A.php'), false);
expect('c4 has no Temp.php', c4tree.has('app/Temp.php'), false);

const single = parseNameStatus(await commitNameStatus(root, c2));
expect('c2 rename detected', single.find(change => change.path === 'app/B.php')?.previousPath, 'app/A.php');

console.log('\nempty range');
const empty = await range(c4, c4);
expect('no uploads', empty.files.length, 0);
expect('no deletions', empty.deletions.length, 0);

rmSync(root, { recursive: true, force: true });

if (problems.length > 0) {
	console.error(`\n${problems.length} FAILURES\n${problems.join('\n')}`);
	process.exit(1);
}
console.log('\nALL EXPECTATIONS MET');

