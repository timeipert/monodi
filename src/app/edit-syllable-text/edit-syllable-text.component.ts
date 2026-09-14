import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
    selector: 'app-edit-syllable-text',
    templateUrl: './edit-syllable-text.component.html',
    styleUrls: ['./edit-syllable-text.component.css'],
    standalone: false
})
export class EditSyllableTextComponent implements OnInit {
  @Input() text!: string;
  @Input() title!: string;
  @Output() updateSyllableText: EventEmitter<string> = new EventEmitter();

  currentText = '';
  constructor(
    public activeModal: NgbActiveModal
  ) { }

  ngOnInit() {
    this.currentText = this.text;
  }

  onSave() {
    this.updateSyllableText.emit(this.currentText.trim());
    this.activeModal.close();
  }

}
