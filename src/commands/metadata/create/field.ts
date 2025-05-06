import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'csv-parse/sync';
import * as fsExtra from 'fs-extra';
import * as xml2js from 'xml2js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-metadata-cli', 'metadata.create.field');

export type MetadataCreateFieldResult = {
  path: string;
  deployedFields: string[];
};

// Interface for CSV field definition
interface FieldDefinition {
  fullName: string;
  label: string;
  type: string;
  length?: string;
  precision?: string;
  scale?: string;
  description?: string;
  formula?: string;
  picklistValues?: string;
  defaultValue?: string;
  required?: string;
  externalId?: string;
  unique?: string;
  caseSensitive?: string;
  inlineHelpText?: string;
}

export default class MetadataCreateField extends SfCommand<MetadataCreateFieldResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-object': Flags.string({
      summary: messages.getMessage('flags.target-object.summary'),
      char: 't',
      required: true,
    }),
    'source-file': Flags.file({
      summary: messages.getMessage('flags.source-file.summary'),
      char: 'f',
      required: true,
      exists: true,
    }),
    'target-org': Flags.requiredOrg(),
    'skip-existing': Flags.boolean({
      summary: 'Skip fields that already exist in the org',
      default: false,
    }),
  };

  public async run(): Promise<MetadataCreateFieldResult> {
    try {
      const { flags } = await this.parse(MetadataCreateField);
      const targetObject = flags['target-object'];
      const sourceFile = flags['source-file'];
      const targetOrg = flags['target-org'];
      const skipExisting = flags['skip-existing'];

      // Display command information
      this.log('=== SF Metadata CLI - Create Field ===');
      this.log(`Target Object: ${targetObject}`);
      this.log(`Source File: ${sourceFile}`);
      this.log(`Target Org: ${targetOrg.getUsername()}`);
      this.log(`Skip Existing Fields: ${skipExisting}`);
      this.log('=====================================');

      // Validate the target object name
      if (!targetObject) {
        throw new SfError('Target object name is required');
      }
      
      // Validate that the source file exists and is a CSV file
      if (!sourceFile.endsWith('.csv')) {
        throw new SfError('Source file must be a CSV file');
      }

      this.log(`Processing field definitions for object: ${targetObject}`);
      this.log(`Reading field definitions from: ${sourceFile}`);

      // Read and parse the CSV file
      const fieldDefinitions = await this.readFieldDefinitions(sourceFile);
      this.log(`Found ${fieldDefinitions.length} field definitions`);

      if (fieldDefinitions.length === 0) {
        throw new SfError('No field definitions found in the CSV file');
      }

      // Validate field definitions and normalize field types
      for (const field of fieldDefinitions) {
        if (!field.fullName || !field.label || !field.type) {
          throw new SfError(`Invalid field definition: fullName, label, and type are required for all fields`);
        }
        if (!field.fullName.endsWith('__c')) {
          throw new SfError(`Invalid field name: ${field.fullName}. Custom field names must end with __c`);
        }
        
        // Normalize field types to match Salesforce API requirements
        if (field.type === 'Boolean') {
          field.type = 'Checkbox';
          this.log(`Normalized field type: ${field.fullName} from Boolean to Checkbox`);
        }
      }

      // Create a temporary directory for the metadata files
      const tempDir = await this.createTempMetadataDirectory(targetObject);
      this.log(`Created temporary metadata directory: ${tempDir}`);

      // Generate XML metadata files for each field
      const deployedFields = await this.generateFieldMetadata(fieldDefinitions, targetObject, tempDir);
      this.log(`Generated metadata for ${deployedFields.length} fields`);

      if (deployedFields.length === 0) {
        throw new SfError('No field metadata was generated');
      }

      // Create the package.xml file with explicit field names
      await this.createPackageXml(tempDir, targetObject, deployedFields);

      // Deploy the metadata to the target org
      await this.deployMetadata(tempDir, targetOrg, skipExisting);
      this.log('Successfully deployed field metadata to the target org');

      // Display summary
      this.log('\n=== Deployment Summary ===');
      this.log(`Total fields processed: ${fieldDefinitions.length}`);
      this.log(`Fields successfully deployed: ${deployedFields.length}`);
      this.log(`Temporary directory: ${tempDir}`);
      this.log('=========================\n');

      return {
        path: tempDir,
        deployedFields,
      };
    } catch (error) {
      // Enhance error reporting
      if (error instanceof SfError) {
        throw error;
      } else {
        throw new SfError(`Error creating fields: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Read and parse the CSV file containing field definitions
   */
  private async readFieldDefinitions(filePath: string): Promise<FieldDefinition[]> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      return records as FieldDefinition[];
    } catch (error) {
      throw new SfError(`Error reading field definitions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a temporary directory for the metadata files
   */
  private async createTempMetadataDirectory(objectName: string): Promise<string> {
    // Create a unique temporary directory
    const tempDir = path.join(os.tmpdir(), `sf-metadata-${Date.now()}`);
    
    // For standard objects, the path should be objects/ObjectName/fields
    // For custom objects, we need to ensure the __c is included
    const isCustomObject = objectName.endsWith('__c');
    const objectApiName = isCustomObject ? objectName : objectName;
    
    // Create the directory structure for fields
    const objectDir = path.join(tempDir, 'objects', objectApiName);
    const fieldsDir = path.join(objectDir, 'fields');
    
    // Create the directory structure
    await fsExtra.ensureDir(fieldsDir);
    this.log(`Created directory structure at: ${fieldsDir}`);
    
    // We'll create the package.xml after generating the field metadata
    // so we can include the specific field names
    this.log(`Will create package.xml for object: ${objectApiName} after generating fields`);
    
    // Log the directory structure for debugging
    this.log('Metadata directory structure:');
    this.log(`- ${tempDir}/`);
    this.log(`  - package.xml`);
    this.log(`  - objects/`);
    this.log(`    - ${objectApiName}/`);
    this.log(`      - fields/`);
    
    return tempDir;
  }

  /**
   * Create the package.xml file
   */
  private async createPackageXml(tempDir: string, objectName: string, fieldNames: string[]): Promise<void> {
    // For Salesforce Metadata API, we need to use a specific format in package.xml
    // For custom fields, we need to list each field explicitly
    const members = fieldNames.map(fieldName => `${objectName}.${fieldName}`);
    
    this.log(`Adding ${members.length} fields to package.xml:`);
    members.forEach(member => this.log(`- ${member}`));
    
    const packageXml = {
      Package: {
        $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
        types: [{
          members: members,
          name: 'CustomField',
        }],
        version: '62.0', // Match the version in sfdx-project.json
      },
    };

    const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: true, indent: '    ', newline: '\n' } });
    const xml = builder.buildObject(packageXml);
    
    await fs.promises.writeFile(path.join(tempDir, 'package.xml'), xml);
    
    this.log(`Created package.xml with ${members.length} custom fields`);
  }

  /**
   * Generate XML metadata files for each field
   */
  private async generateFieldMetadata(
    fieldDefinitions: FieldDefinition[],
    objectName: string,
    tempDir: string
  ): Promise<string[]> {
    const deployedFields: string[] = [];

    for (const field of fieldDefinitions) {
      try {
        const fieldXml = this.createFieldXml(field);
        const fieldFileName = `${field.fullName}.field-meta.xml`;
        const fieldFilePath = path.join(tempDir, 'objects', objectName, 'fields', fieldFileName);
        
        await fs.promises.writeFile(fieldFilePath, fieldXml);
        deployedFields.push(field.fullName);
        
        this.log(`Created field metadata: ${fieldFileName}`);
      } catch (error) {
        this.warn(`Error creating metadata for field ${field.fullName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return deployedFields;
  }

  /**
   * Create XML for a field definition
   */
  private createFieldXml(field: FieldDefinition): string {
    // Create the base field object
    const fieldObj: any = {
      $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
      fullName: field.fullName,
      label: field.label,
      type: field.type,
    };

    // Add optional fields if they exist
    if (field.length) fieldObj.length = field.length;
    if (field.precision) fieldObj.precision = field.precision;
    if (field.scale) fieldObj.scale = field.scale;
    if (field.description) fieldObj.description = field.description;
    if (field.formula) fieldObj.formula = field.formula;
    if (field.defaultValue) fieldObj.defaultValue = field.defaultValue;
    
    // Convert boolean strings to actual booleans
    if (field.required) fieldObj.required = field.required.toLowerCase() === 'true';
    if (field.externalId) fieldObj.externalId = field.externalId.toLowerCase() === 'true';
    if (field.unique) fieldObj.unique = field.unique.toLowerCase() === 'true';
    if (field.caseSensitive) fieldObj.caseSensitive = field.caseSensitive.toLowerCase() === 'true';
    
    if (field.inlineHelpText) fieldObj.inlineHelpText = field.inlineHelpText;

    // Handle different field types
    switch (field.type) {
      case 'Picklist':
        if (field.picklistValues) {
          const values = field.picklistValues.split(',').map(value => value.trim());
          fieldObj.valueSet = {
            valueSetDefinition: {
              sorted: false,
              value: values.map(value => ({
                fullName: value,
                default: value === field.defaultValue,
                label: value,
              })),
            },
          };
          
          // Remove defaultValue as it's handled in the valueSet
          delete fieldObj.defaultValue;
        }
        break;
      
      case 'Text':
      case 'Phone':
      case 'URL':
        // Ensure length is set for text-based fields
        if (!fieldObj.length) {
          fieldObj.length = field.type === 'Text' ? '255' : '100';
        }
        break;
        
      case 'Email':
        // Email fields should not have length specified
        delete fieldObj.length;
        break;
      
      case 'Number':
      case 'Currency':
      case 'Percent':
        // Ensure precision and scale are set for numeric fields
        if (!fieldObj.precision) {
          fieldObj.precision = '18';
        }
        if (!fieldObj.scale) {
          fieldObj.scale = '2';
        }
        break;
      
      case 'Checkbox':
        // Checkbox fields must have a defaultValue
        if (fieldObj.defaultValue === undefined) {
          fieldObj.defaultValue = false;
        }
        break;
      
      case 'TextArea':
        if (!fieldObj.length) {
          fieldObj.length = '1000';
        }
        break;
      
      case 'LongTextArea':
      case 'Html':
        if (!fieldObj.length) {
          fieldObj.length = '32768';
        }
        if (!fieldObj.visibleLines) {
          fieldObj.visibleLines = '10';
        }
        break;
    }

    // Log the field XML for debugging
    this.log(`Generating XML for field: ${field.fullName} (${field.type})`);
    
    // Convert to XML
    const builder = new xml2js.Builder({
      headless: true,
      renderOpts: { pretty: true, indent: '    ', newline: '\n' },
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
    
    const xml = builder.buildObject({ CustomField: fieldObj });
    
    // Log a sample of the XML for debugging
    const xmlPreview = xml.length > 200 ? xml.substring(0, 200) + '...' : xml;
    this.log(`XML preview: ${xmlPreview.replace(/\n/g, ' ')}`);
    
    return xml;
  }

  /**
   * Parse field XML to extract metadata
   */
  private parseFieldXml(xml: string): any {
    // Parse the XML to get the field metadata
    const parser = new xml2js.Parser({ explicitArray: false });
    let fieldMetadata: any = {};
    
    parser.parseString(xml, (err: Error | null, result: any) => {
      if (err) {
        throw new SfError(`Error parsing field XML: ${err.message}`);
      }
      
      fieldMetadata = result.CustomField;
    });
    
    // Remove the XML namespace
    if (fieldMetadata.$) {
      delete fieldMetadata.$;
    }
    
    return fieldMetadata;
  }

  /**
   * Deploy the metadata to the target org using the Metadata API
   */
  private async deployMetadata(tempDir: string, org: any, skipExisting: boolean): Promise<void> {
    try {
      this.log('Creating fields directly in the org using Metadata API...');
      
      // Get the connection to the org
      const conn = org.getConnection();
      
      // Get the field metadata files
      const fieldsDir = path.join(tempDir, 'objects', 'Account', 'fields');
      const fieldFiles = await fs.promises.readdir(fieldsDir);
      
      this.log(`Found ${fieldFiles.length} field metadata files`);
      
      // Create metadata records for each field
      const metadataRecords = [];
      
      for (const file of fieldFiles) {
        // Read the field metadata
        const fieldPath = path.join(fieldsDir, file);
        const fieldXml = await fs.promises.readFile(fieldPath, 'utf8');
        
        // Extract the field name from the file name
        const fieldName = path.basename(file, '.field-meta.xml');
        
        // Parse the XML to get the field metadata
        const fieldMetadata = this.parseFieldXml(fieldXml);
        
        // Add to metadata records - directly use the field metadata
        fieldMetadata.fullName = `Account.${fieldName}`;
        metadataRecords.push(fieldMetadata);
      }
      
      // Deploy all fields at once using the Metadata API
      this.log(`Deploying ${metadataRecords.length} fields to the org...`);
      
      // Use the Metadata API to create the fields
      const result = await conn.metadata.create('CustomField', metadataRecords);
      
      // Process results
      const successfulFields = [];
      const failedFields = [];
      
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i++) {
          const fieldResult = result[i];
          const fieldName = metadataRecords[i].fullName.split('.')[1];
          
          if (fieldResult.success) {
            successfulFields.push(fieldName);
            this.log(`Successfully created field: ${fieldName}`);
          } else {
            const errorMessage = fieldResult.errors ?
              (Array.isArray(fieldResult.errors) ?
                fieldResult.errors.map((e: any) => e.message || e.toString()).join(', ') :
                fieldResult.errors.toString()) :
              'Unknown error';
            
            // Check if the field already exists and we should skip it
            const alreadyExistsError = errorMessage.includes('already a field named') ||
                                      errorMessage.includes('already exists');
            
            if (alreadyExistsError && skipExisting) {
              this.log(`Skipping existing field: ${fieldName}`);
              // Don't count as a failure if we're skipping existing fields
              successfulFields.push(fieldName);
            } else {
              failedFields.push({
                name: fieldName,
                error: errorMessage
              });
              this.warn(`Failed to create field: ${fieldName} - ${errorMessage}`);
            }
          }
        }
      } else {
        // Single result
        const fieldName = metadataRecords[0].fullName.split('.')[1];
        if (result.success) {
          successfulFields.push(fieldName);
          this.log(`Successfully created field: ${fieldName}`);
        } else {
          const errorMessage = result.errors ?
            (Array.isArray(result.errors) ?
              result.errors.map((e: any) => e.message || e.toString()).join(', ') :
              result.errors.toString()) :
            'Unknown error';
          
          // Check if the field already exists and we should skip it
          const alreadyExistsError = errorMessage.includes('already a field named') ||
                                    errorMessage.includes('already exists');
          
          if (alreadyExistsError && skipExisting) {
            this.log(`Skipping existing field: ${fieldName}`);
            // Don't count as a failure if we're skipping existing fields
            successfulFields.push(fieldName);
          } else {
            failedFields.push({
              name: fieldName,
              error: errorMessage
            });
            this.warn(`Failed to create field: ${fieldName} - ${errorMessage}`);
          }
        }
      }
      
      // Log results
      this.log(`\n=== Field Creation Results ===`);
      this.log(`Total fields: ${fieldFiles.length}`);
      this.log(`Successfully created: ${successfulFields.length}`);
      this.log(`Failed: ${failedFields.length}`);
      
      if (successfulFields.length > 0) {
        this.log(`\nSuccessfully created fields:`);
        successfulFields.forEach(field => this.log(`- ${field}`));
      }
      
      if (failedFields.length > 0) {
        this.log(`\nFailed fields:`);
        failedFields.forEach(field => this.log(`- ${field.name}: ${field.error}`));
      }
      
      if (failedFields.length > 0) {
        throw new SfError(`Failed to create ${failedFields.length} fields. See log for details.`);
      }
      
      this.log('Successfully deployed all fields to the target org');
    } catch (error) {
      throw new SfError(`Error deploying metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
