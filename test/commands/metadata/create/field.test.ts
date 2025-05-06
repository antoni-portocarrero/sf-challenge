import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestContext } from '@salesforce/core/testSetup';
import { SfError } from '@salesforce/core';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import * as sinon from 'sinon';
import MetadataCreateField from '../../../../src/commands/metadata/create/field.js';

describe('metadata create field', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let readFileSyncStub: sinon.SinonStub;

  // Sample CSV content for testing
  const sampleCsvContent = `fullName,label,type,length,precision,scale,description,formula,picklistValues,defaultValue,required,externalId,unique,caseSensitive,inlineHelpText
Account_Number__c,Account Number,Text,20,,,Unique identifier for the account,,,,TRUE,TRUE,TRUE,FALSE,Enter the account's unique number.
Order_Total__c,Order Total,Currency,,18,2,The total value of the order,,,0.00,TRUE,FALSE,FALSE,FALSE,
Is_Active__c,Is Active,Checkbox,,,,,,,,FALSE,FALSE,FALSE,FALSE,Check if the record is active.
Status__c,Status,Picklist,,,,,,"New,In Progress,Completed",New,TRUE,FALSE,FALSE,FALSE,Select the current status.`;

  // Mock org connection
  const mockOrg = {
    getUsername: () => 'test@example.com',
    getConnection: () => ({
      metadata: {
        create: sinon.stub().resolves([
          { success: true },
          { success: true },
          { success: true },
          { success: false, errors: ['Field already exists'] }
        ])
      }
    })
  };

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    
    // Stub file system operations
    readFileSyncStub = sinon.stub(fs, 'readFileSync').returns(sampleCsvContent);
    sinon.stub(fs, 'writeFileSync').returns();
    sinon.stub(fs, 'mkdirSync').returns(undefined);
    sinon.stub(fs, 'existsSync').returns(true);
    
    // Create mock Dirent objects
    const createDirent = (name: string): fs.Dirent => {
      const dirent = new fs.Dirent();
      dirent.name = name;
      dirent.isFile = () => true;
      dirent.isDirectory = () => false;
      dirent.isBlockDevice = () => false;
      dirent.isCharacterDevice = () => false;
      dirent.isSymbolicLink = () => false;
      dirent.isFIFO = () => false;
      dirent.isSocket = () => false;
      return dirent;
    };
    
    sinon.stub(fs, 'readdirSync').returns([
      createDirent('Account_Number__c.field-meta.xml'),
      createDirent('Order_Total__c.field-meta.xml'),
      createDirent('Is_Active__c.field-meta.xml'),
      createDirent('Status__c.field-meta.xml')
    ]);
    
    // Stub fs.promises
    sinon.stub(fs, 'promises').value({
      readFile: sinon.stub().resolves('<CustomField></CustomField>'),
      writeFile: sinon.stub().resolves(),
      readdir: sinon.stub().resolves([
        'Account_Number__c.field-meta.xml',
        'Order_Total__c.field-meta.xml',
        'Is_Active__c.field-meta.xml',
        'Status__c.field-meta.xml'
      ])
    });
    
    // Stub path operations
    sinon.stub(path, 'join').callsFake((...args) => args.join('/'));
    sinon.stub(path, 'basename').callsFake((filePath: string, ext?: string) => {
      const base = filePath.split('/').pop() || '';
      return ext ? base.replace(ext, '') : base;
    });
    
    // Stub os.tmpdir
    sinon.stub(require('node:os'), 'tmpdir').returns('/tmp');
  });

  afterEach(() => {
    $$.restore();
    sinon.restore();
  });

  it('should create fields from CSV file', async () => {
    // Run the command
    const result = await MetadataCreateField.run([
      '--target-object', 'Account',
      '--source-file', './test/data/fields.csv',
      '--target-org', 'test@example.com'
    ]);
    
    // Verify the command output
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    
    // Check that the command logged the expected messages
    expect(output).to.include('SF Metadata CLI - Create Field');
    expect(output).to.include('Target Object: Account');
    expect(output).to.include('Source File: ./test/data/fields.csv');
    expect(output).to.include('Found 4 field definitions');
    expect(output).to.include('Successfully deployed field metadata to the target org');
    
    // Verify the result
    expect(result).to.have.property('path');
    expect(result).to.have.property('deployedFields');
    expect(result.deployedFields).to.have.lengthOf(4);
  });

  it('should normalize Boolean fields to Checkbox', async () => {
    // Modify the sample CSV to include a Boolean field
    readFileSyncStub.returns(`fullName,label,type,length,precision,scale,description
VIP_Customer__c,VIP Customer,Boolean,,,,Indicates if the customer is a VIP`);
    
    // Run the command
    await MetadataCreateField.run([
      '--target-object', 'Account',
      '--source-file', './test/data/fields.csv',
      '--target-org', 'test@example.com'
    ]);
    
    // Verify the command output
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    
    // Check that the command logged the field type normalization
    expect(output).to.include('Normalized field type: VIP_Customer__c from Boolean to Checkbox');
  });

  it('should skip existing fields when --skip-existing flag is used', async () => {
    // Mock the metadata API to return an error for an existing field
    const mockConnection = {
      metadata: {
        create: sinon.stub().resolves([
          { success: false, errors: ['already a field named Account_Number'] }
        ])
      }
    };
    
    // Mock the org connection
    sinon.stub(mockOrg, 'getConnection').returns(mockConnection);
    
    // Run the command with --skip-existing flag
    await MetadataCreateField.run([
      '--target-object', 'Account',
      '--source-file', './test/data/fields.csv',
      '--target-org', 'test@example.com',
      '--skip-existing'
    ]);
    
    // Verify the command output
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    
    // Check that the command logged the skipped field
    expect(output).to.include('Skipping existing field: Account_Number__c');
  });

  it('should handle errors for invalid field definitions', async () => {
    // Modify the sample CSV to include an invalid field (missing required properties)
    readFileSyncStub.returns(`fullName,label,type
Invalid__c,,`);
    
    try {
      // Run the command
      await MetadataCreateField.run([
        '--target-object', 'Account',
        '--source-file', './test/data/fields.csv',
        '--target-org', 'test@example.com'
      ]);
      
      // If we get here, the test should fail
      expect.fail('Command should have thrown an error');
    } catch (error) {
      // Verify the error
      if (error instanceof SfError) {
        expect(error.message).to.include('Invalid field definition');
      } else {
        expect.fail('Error should be an instance of SfError');
      }
    }
  });

  it('should validate that field names end with __c', async () => {
    // Modify the sample CSV to include an invalid field name
    readFileSyncStub.returns(`fullName,label,type
InvalidFieldName,Invalid Field,Text`);
    
    try {
      // Run the command
      await MetadataCreateField.run([
        '--target-object', 'Account',
        '--source-file', './test/data/fields.csv',
        '--target-org', 'test@example.com'
      ]);
      
      // If we get here, the test should fail
      expect.fail('Command should have thrown an error');
    } catch (error) {
      // Verify the error
      if (error instanceof SfError) {
        expect(error.message).to.include('Invalid field name');
        expect(error.message).to.include('Custom field names must end with __c');
      } else {
        expect.fail('Error should be an instance of SfError');
      }
    }
  });
});
