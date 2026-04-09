import prompts from "prompts";
import { assert, type Mock } from "vitest";

/**
 * The expected values for a confirmation request.
 */
export interface ConfirmExpectation {
	/** The text expected to be seen in the confirmation dialog. */
	text: string;

	options?: { defaultValue: boolean };
	/** The mock response send back from the confirmation dialog. */
	result: boolean;
}

/**
 * Mock the implementation of `confirm()` that will respond with configured results
 * for configured confirmation text messages.
 *
 * If there is a call to `confirm()` that does not match any of the expectations
 * then an error is thrown.
 */
export function mockConfirm(...expectations: ConfirmExpectation[]) {
	for (const expectation of expectations) {
		(prompts as unknown as Mock).mockImplementationOnce(
			({ type, name, message, initial }) => {
				assert(type === "confirm");
				assert(name === "value");
				assert(message === expectation.text);
				if (expectation.options) {
					assert(initial === expectation.options?.defaultValue);
				}

				return Promise.resolve({ value: expectation.result });
			}
		);
	}
}

/**
 * The expected values for a prompt request.
 */
export interface PromptExpectation {
	/** The text expected to be seen in the prompt dialog. */
	text: string;
	/** The type of the prompt. */
	options?: {
		defaultValue?: string;
		isSecret?: boolean;
	};
	/** The mock response send back from the prompt dialog. */
	result: string;
}

/**
 * Mock the implementation of `prompt()` that will respond with configured results
 * for configured prompt text messages.
 *
 * If there is a call to `prompt()` that does not match any of the expectations
 * then an error is thrown.
 */
export function mockPrompt(...expectations: PromptExpectation[]) {
	for (const expectation of expectations) {
		(prompts as unknown as Mock).mockImplementationOnce(
			({ type, name, message, initial, style }) => {
				assert(type === "text");
				assert(name === "value");
				assert(message === expectation.text);
				if (expectation.options) {
					assert(initial === expectation.options?.defaultValue);
					assert(
						style === (expectation.options?.isSecret ? "password" : "default")
					);
				}
				return Promise.resolve({ value: expectation.result });
			}
		);
	}
}

interface SelectOptions<Values> {
	choices: SelectOption<Values>[];
	defaultOption?: number;
}

interface SelectOption<Values> {
	title: string;
	description?: string;
	value: Values;
}
/**
 * The expected values for a select request.
 */
export interface SelectExpectation<Values> {
	/** The text expected to be seen in the select dialog. */
	text: string;

	options?: SelectOptions<Values>;
	/** The mock response send back from the select dialog. */
	result: string;
}

/**
 * Mock the implementation of `select()` that will respond with configured results
 * for configured select text messages.
 *
 * If there is a call to `select()` that does not match any of the expectations
 * then an error is thrown.
 */
export function mockSelect<Values>(
	...expectations: SelectExpectation<Values>[]
) {
	for (const expectation of expectations) {
		(prompts as unknown as Mock).mockImplementationOnce(
			({ type, name, message, choices, initial }) => {
				assert(type === "select");
				assert(name === "value");
				assert(message === expectation.text);
				if (expectation.options) {
					assert(choices === expectation.options?.choices);
					assert(initial === expectation.options?.defaultOption);
				}
				return Promise.resolve({ value: expectation.result });
			}
		);
	}
}

export function clearDialogs() {
	let error: Error | undefined;
	try {
		// No dialog mocks should be left after each test, and so calling the dialog methods should throw
		void prompts({ type: "select", name: "unknown" });
	} catch (e) {
		assert(e instanceof Error);
		error = e;
	}
	assert(error);
	assert(error.message.startsWith("Unexpected call to "));
}
