# SF Metadata CLI

A Salesforce CLI plugin for creating and managing Salesforce metadata from external sources.

## Overview

SF Metadata CLI extends the Salesforce CLI with commands that allow you to create and deploy Salesforce metadata from external sources such as CSV files. This plugin simplifies the process of setting up new orgs or making bulk changes to existing orgs by automating the creation and deployment of metadata.

## Features

- Create custom fields from CSV definitions
- Automatically generate and deploy metadata XML files
- Support for various field types (Text, Currency, Checkbox, Picklist, Date, etc.)
- Proper handling of field attributes (required, externalId, unique, etc.)

## Installation

```bash
sf plugins install sf-metadata-cli
```

## Commands

### metadata create field

Create and deploy custom fields from a CSV file.

```bash
sf metadata create field --target-object <object-name> --source-file <csv-file-path> --target-org <org-username-or-alias>
```

#### Flags

- `--target-object, -t` (required): The object where fields will be created for
- `--source-file, -f` (required): The source file with the Field definitions
- `--target-org` (required): The target Salesforce org where the fields will be deployed
- `--skip-existing` (optional): Skip fields that already exist in the org instead of reporting errors

#### Examples

```bash
# Create fields for the Account object from a CSV file
sf metadata create field --target-object Account --source-file ./fields.csv --target-org my-dev-org

# Skip fields that already exist in the org
sf metadata create field --target-object Account --source-file ./fields.csv --target-org my-dev-org --skip-existing

# Using aliases for flags
sf metadata create field -t Contact -f ./contact_fields.csv --target-org my-dev-org
```

### CSV Format Example

The CSV file should have the following format:

```csv
fullName,label,type,length,precision,scale,description,formula,picklistValues,defaultValue,required,externalId,unique,caseSensitive,inlineHelpText
Account_Number__c,Account Number,Text,20,,,Unique identifier for the account,,,,TRUE,TRUE,TRUE,FALSE,Enter the account's unique number.
Order_Total__c,Order Total,Currency,,18,2,The total value of the order,,,0.00,TRUE,FALSE,FALSE,FALSE,
Is_Active__c,Is Active,Checkbox,,,,,,,,FALSE,FALSE,FALSE,FALSE,Check if the record is active.
Status__c,Status,Picklist,,,,,,"New,In Progress,Completed",New,TRUE,FALSE,FALSE,FALSE,Select the current status.
```

## Documentation

- [User Guide](./docs/user-guide.md) - Detailed instructions on how to use the plugin
- [Architecture](./docs/architecture.md) - Technical details about the plugin's architecture

## Development

### Prerequisites

- Node.js 18 or later
- Salesforce CLI

### Setup

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Build the plugin:

```bash
npm run build
```

### Testing

```bash
npm test
```

## License

BSD-3-Clause
