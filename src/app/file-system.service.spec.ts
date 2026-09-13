import { TestBed } from '@angular/core/testing';
import { FileSystemService } from './file-system.service';

describe('FileSystemService', () => {
  let service: FileSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FileSystemService]
    });
    service = TestBed.inject(FileSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should detect file system support based on window properties', () => {
    const isSupported = service.isSupported();
    expect(typeof isSupported).toBe('boolean');
  });

  it('should fallback to downloadBlob when showSaveFilePicker is not available', async () => {
    spyOn(service, 'isSupported').and.returnValue(false);
    spyOn(service, 'downloadBlob');

    const res = await service.saveFile('test-content', { suggestedName: 'test.txt' });

    expect(res.saved).toBeTrue();
    expect(service.downloadBlob).toHaveBeenCalled();
  });
});
