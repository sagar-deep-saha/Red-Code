/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildFilter,
	classFromTestPath,
	parseJUnit,
	parseTestList,
	parseTestSource,
	parseXml,
	testIdentity
} from '../index/junit.js';

/**
 * Captured from PHPUnit 12.5 on the Laravel fixture, then trimmed to one case
 * per outcome. Suites nest `testsuites` → `Unit`/`Feature` → class, exactly as
 * PHPUnit emits them.
 */
const junit = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="C:\project\phpunit.xml" tests="6" assertions="5" errors="1" failures="1" skipped="1" time="1.011308">
    <testsuite name="Unit" tests="1" assertions="1" errors="0" failures="0" skipped="0" time="0.002212">
      <testsuite name="Tests\Unit\ExampleTest" file="C:\project\tests\Unit\ExampleTest.php" tests="1" assertions="1" errors="0" failures="0" skipped="0" time="0.002212">
        <testcase name="test_that_true_is_true" file="C:\project\tests\Unit\ExampleTest.php" line="12" class="Tests\Unit\ExampleTest" classname="Tests.Unit.ExampleTest" assertions="1" time="0.002212"/>
      </testsuite>
    </testsuite>
    <testsuite name="Feature" tests="5" assertions="4" errors="1" failures="1" skipped="1" time="1.009096">
      <testsuite name="Tests\Feature\ExampleTest" file="C:\project\tests\Feature\ExampleTest.php" tests="1" assertions="1" errors="0" failures="0" skipped="0" time="0.493546">
        <testcase name="test_the_application_returns_a_successful_response" file="C:\project\tests\Feature\ExampleTest.php" line="13" class="Tests\Feature\ExampleTest" classname="Tests.Feature.ExampleTest" assertions="1" time="0.493546"/>
      </testsuite>
      <testsuite name="Tests\Feature\PostTest" file="C:\project\tests\Feature\PostTest.php" tests="4" assertions="3" errors="1" failures="1" skipped="1" time="0.515550">
        <testcase name="test_posts_index_renders_existing_posts" file="C:\project\tests\Feature\PostTest.php" line="14" class="Tests\Feature\PostTest" classname="Tests.Feature.PostTest" assertions="2" time="0.481805"/>
        <testcase name="test_fixture_failure_for_result_mapping" file="C:\project\tests\Feature\PostTest.php" line="31" class="Tests\Feature\PostTest" classname="Tests.Feature.PostTest" assertions="1" time="0.033745">
          <failure type="PHPUnit\Framework\ExpectationFailedException">Tests\Feature\PostTest::test_fixture_failure_for_result_mapping&#13;
Fixture failure used by Red Code acceptance tests.
Failed asserting that two strings are identical.
--- Expected
+++ Actual
@@ @@
-'expected'
+'actual'
&#13;
C:\project\tests\Feature\PostTest.php:33</failure>
        </testcase>
        <testcase name="test_posts_index_handles_a_broken_connection" file="C:\project\tests\Feature\PostTest.php" line="40" class="Tests\Feature\PostTest" classname="Tests.Feature.PostTest" assertions="0" time="0.001000">
          <error type="RuntimeException">Tests\Feature\PostTest::test_posts_index_handles_a_broken_connection&#13;
SQLSTATE[HY000]: connection refused</error>
        </testcase>
        <testcase name="test_skipped_without_a_database" file="C:\project\tests\Feature\PostTest.php" line="48" class="Tests\Feature\PostTest" classname="Tests.Feature.PostTest" assertions="0" time="0.000100">
          <skipped/>
        </testcase>
      </testsuite>
    </testsuite>
  </testsuite>
</testsuites>`;

const testList = String.raw`<?xml version="1.0"?>
<testSuite xmlns="https://xml.phpunit.de/testSuite">
 <tests>
  <testClass name="Tests\Unit\ExampleTest" file="C:\project\tests\Unit\ExampleTest.php">
   <testMethod id="Tests\Unit\ExampleTest::test_that_true_is_true" name="test_that_true_is_true"/>
  </testClass>
  <testClass name="Tests\Feature\PostTest" file="C:\project\tests\Feature\PostTest.php">
   <testMethod id="Tests\Feature\PostTest::test_posts_index_renders_existing_posts" name="test_posts_index_renders_existing_posts"/>
   <testMethod id="Tests\Feature\PostTest::test_fixture_failure_for_result_mapping" name="test_fixture_failure_for_result_mapping"/>
  </testClass>
 </tests>
 <groups>
  <group name="default">
   <test id="Tests\Unit\ExampleTest::test_that_true_is_true"/>
  </group>
 </groups>
</testSuite>`;

const results = parseJUnit(junit);
const byName = (name: string) => results.find(result => result.name === name);

test('every nested suite is walked, not just a single flat suite', () => {
	assert.equal(results.length, 6);
	assert.deepEqual(
		results.map(result => result.class),
		[
			'Tests\\Unit\\ExampleTest',
			'Tests\\Feature\\ExampleTest',
			'Tests\\Feature\\PostTest',
			'Tests\\Feature\\PostTest',
			'Tests\\Feature\\PostTest',
			'Tests\\Feature\\PostTest'
		]
	);
});

test('a testcase without a child element passed', () => {
	const passed = byName('test_posts_index_renders_existing_posts');
	assert.ok(passed);
	assert.equal(passed.outcome, 'passed');
	assert.equal(passed.message, undefined);
	assert.equal(passed.file, String.raw`C:\project\tests\Feature\PostTest.php`);
	assert.equal(passed.line, 14);
	assert.equal(passed.time, 0.481805);
});

test('a failure maps to a failed result with file, line and message', () => {
	const failed = byName('test_fixture_failure_for_result_mapping');
	assert.ok(failed);
	assert.equal(failed.outcome, 'failed');
	assert.equal(failed.file, String.raw`C:\project\tests\Feature\PostTest.php`);
	assert.equal(failed.line, 31);
	assert.ok(failed.message);
	assert.ok(failed.message.startsWith('Fixture failure used by Red Code acceptance tests.'));
	assert.match(failed.message, /Failed asserting that two strings are identical\./);
	assert.match(failed.message, /PostTest\.php:33$/);
	assert.ok(!failed.message.includes('::'), 'the redundant Class::method line is dropped');
});

test('an error maps to an errored result', () => {
	const errored = byName('test_posts_index_handles_a_broken_connection');
	assert.ok(errored);
	assert.equal(errored.outcome, 'errored');
	assert.equal(errored.message, 'SQLSTATE[HY000]: connection refused');
});

test('a skipped testcase maps to a skipped result', () => {
	const skipped = byName('test_skipped_without_a_database');
	assert.ok(skipped);
	assert.equal(skipped.outcome, 'skipped');
	assert.equal(skipped.message, undefined);
});

test('malformed or empty input yields no results instead of throwing', () => {
	assert.deepEqual(parseJUnit(''), []);
	assert.deepEqual(parseJUnit('<testsuites><testsuite>'), []);
	assert.deepEqual(parseJUnit('not xml at all'), []);
});

test('the reader tolerates a prologue, comments, CDATA and entities', () => {
	const xml = '<?xml version="1.0"?><!-- ignore --><!DOCTYPE x><r><a b="1 &amp; 2"><![CDATA[<raw>]]></a><a b=\'v\'/></r>';
	const root = parseXml(xml);
	assert.ok(root);
	assert.equal(root.name, 'r');
	assert.equal(root.children.length, 2);
	assert.equal(root.children[0].attributes['b'], '1 & 2');
	assert.equal(root.children[0].text, '<raw>');
	assert.equal(root.children[1].attributes['b'], 'v');
});

test('the test list reports one entry per test method', () => {
	const discovered = parseTestList(testList);
	assert.deepEqual(discovered, [
		{
			id: 'Tests\\Unit\\ExampleTest::test_that_true_is_true',
			name: 'test_that_true_is_true',
			class: 'Tests\\Unit\\ExampleTest',
			file: String.raw`C:\project\tests\Unit\ExampleTest.php`
		},
		{
			id: 'Tests\\Feature\\PostTest::test_posts_index_renders_existing_posts',
			name: 'test_posts_index_renders_existing_posts',
			class: 'Tests\\Feature\\PostTest',
			file: String.raw`C:\project\tests\Feature\PostTest.php`
		},
		{
			id: 'Tests\\Feature\\PostTest::test_fixture_failure_for_result_mapping',
			name: 'test_fixture_failure_for_result_mapping',
			class: 'Tests\\Feature\\PostTest',
			file: String.raw`C:\project\tests\Feature\PostTest.php`
		}
	]);
	assert.deepEqual(parseTestList('<testSuite/>'), []);
});

test('a result is identified the way PHPUnit identifies a test', () => {
	const failed = byName('test_fixture_failure_for_result_mapping');
	assert.ok(failed);
	assert.equal(testIdentity(failed), String.raw`Tests\Feature\PostTest::test_fixture_failure_for_result_mapping`);
});

test('a test file path maps to the class name PHPUnit reports', () => {
	assert.equal(classFromTestPath('tests/Unit/ExampleTest.php'), String.raw`Tests\Unit\ExampleTest`);
	assert.equal(classFromTestPath('tests\\Feature\\Nested\\PostTest.php'), String.raw`Tests\Feature\Nested\PostTest`);
	assert.equal(classFromTestPath('tests/TestCase.php'), String.raw`Tests\TestCase`);
	assert.equal(classFromTestPath('app/Models/PostTest.php'), undefined);
	assert.equal(classFromTestPath('tests/Feature/PostTest.txt'), undefined);
});

test('the source fallback reads test methods and #[Test] attributes', () => {
	const source = [
		'<?php',
		'class PostTest extends TestCase {',
		'    public function test_posts_index_renders_existing_posts(): void {}',
		'    private function helper(): void {}',
		'    #[Test]',
		'    public function it_maps_a_failure(): void {}',
		'}'
	].join('\n');
	assert.deepEqual(parseTestSource(source), ['test_posts_index_renders_existing_posts', 'it_maps_a_failure']);
	assert.deepEqual(parseTestSource('<?php class X { private function helper(): void {} }'), []);
});

test('the filter argument escapes regex characters and is skipped when empty', () => {
	assert.equal(buildFilter([]), undefined);
	assert.equal(buildFilter(['', '']), undefined);
	assert.equal(
		buildFilter([String.raw`Tests\Feature\PostTest::test_posts_index_renders_existing_posts`]),
		String.raw`/(Tests\\Feature\\PostTest::test_posts_index_renders_existing_posts)/`
	);
	assert.equal(
		buildFilter([String.raw`A\B::a`, String.raw`A\B::b`]),
		String.raw`/(A\\B::a|A\\B::b)/`
	);
});
